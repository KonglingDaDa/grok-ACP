import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { nowBeijingIso, nowBeijingStamp } from "./config.mjs";
import { getGrokAcpHome, getRunsDir } from "./paths.mjs";

// CJK detection ranges copied verbatim from docs/monitor-ui-design.md §2.5.
const CJK_PATTERN = /[　-〿㐀-鿿豈-﫿＀-￯]/;

const activeExitFinalizers = new Set();
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const finalize of activeExitFinalizers) {
      try {
        finalize();
      } catch {
        // best effort during process exit
      }
    }
  });
}

const SAMPLE_INTERVAL_MS = 1000;
const META_REWRITE_EVERY_N_TICKS = 2;
const OUTPUT_FLUSH_MS = 200;
const DEFAULT_MAX_AGE_DAYS = 7;

export function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.round(cjk * 1 + other / 4);
}

// Best-effort rolling cleanup. Never throws — monitoring must never affect
// the CLI's main run/compact flow.
export function cleanupOldRuns(runsDir, maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  try {
    if (!fs.existsSync(runsDir)) return [];
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const entries = fs.readdirSync(runsDir, { withFileTypes: true });
    const removed = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(runsDir, entry.name);
      let startedAtMs = null;

      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
        const parsed = meta?.startedAt ? Date.parse(meta.startedAt) : NaN;
        if (Number.isFinite(parsed)) startedAtMs = parsed;
      } catch {
        // fall through to mtime fallback below
      }

      if (startedAtMs === null) {
        try {
          startedAtMs = fs.statSync(dir).mtimeMs;
        } catch {
          continue;
        }
      }

      if (now - startedAtMs > maxAgeMs) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          removed.push(entry.name);
        } catch {
          // best effort; leave it for the next cleanup pass
        }
      }
    }
    return removed;
  } catch {
    // cleanup is best-effort only
    return [];
  }
}

/**
 * createTaskRecorder({ command, name, prompt, model, targetCwd, invokerCwd })
 *   -> { taskId, onChunk(text), onToolEvent(), setSessionId(id), finish({ status, error, reportPath, jsonPath, context }) }
 *
 * Writes ~/.grok-acp/runs/<taskId>/{meta.json,throughput.ndjson,output.md} per
 * docs/monitor-ui-design.md §2. This is a side channel: every fs operation is
 * try/catch guarded and failures degrade silently (at most one stderr line
 * per recorder instance) so monitoring can never break run/compact.
 */
export function createTaskRecorder(options = {}) {
  const home = getGrokAcpHome();
  const runsDir = getRunsDir(home);
  const taskId = `${nowBeijingStamp()}-${crypto.randomBytes(2).toString("hex")}`;
  const taskDir = path.join(runsDir, taskId);
  const metaPath = path.join(taskDir, "meta.json");
  const throughputPath = path.join(taskDir, "throughput.ndjson");
  const outputPath = path.join(taskDir, "output.md");

  const prompt = typeof options.prompt === "string" ? options.prompt : "";
  const startedAt = nowBeijingIso();

  const state = {
    id: taskId,
    name: options.name || "grok-acp-task",
    command: options.command,
    status: "running",
    prompt,
    promptPreview: prompt.slice(0, 160),
    model: options.model || null,
    targetCwd: options.targetCwd || null,
    invokerCwd: options.invokerCwd || null,
    sessionId: null,
    pid: process.pid, // grok-acp CLI process; monitor uses kill(pid,0) to detect interrupted runs
    startedAt,
    endedAt: null,
    heartbeatAt: startedAt,
    tokensOut: 0,
    chars: 0,
    resultStart: 0,
    durationMs: null,
    context: null,
    reportPath: null,
    jsonPath: null,
    error: null,
  };

  let finished = false;
  let warned = false;
  let tickCount = 0;
  let lastCum = 0;
  let outputBuffer = "";
  let outputFlushTimer = null;

  function warnOnce(key, err) {
    if (warned) return;
    warned = true;
    try {
      console.error(`grokACP [${key}]: ${err?.message || err}`);
    } catch {
      // stderr itself is unavailable; nothing more we can do
    }
  }

  function ensureDir() {
    try {
      fs.mkdirSync(taskDir, { recursive: true });
      return true;
    } catch (err) {
      warnOnce("mkdir", err);
      return false;
    }
  }

  function writeMetaAtomic() {
    try {
      if (!ensureDir()) return;
      const tmpPath = `${metaPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
      fs.renameSync(tmpPath, metaPath);
    } catch (err) {
      warnOnce("writeMeta", err);
    }
  }

  function appendThroughput(sample) {
    try {
      if (!ensureDir()) return;
      fs.appendFileSync(throughputPath, JSON.stringify(sample) + "\n", "utf8");
    } catch (err) {
      warnOnce("appendThroughput", err);
    }
  }

  function flushOutput() {
    if (!outputBuffer) return;
    const chunk = outputBuffer;
    outputBuffer = "";
    try {
      if (!ensureDir()) return;
      fs.appendFileSync(outputPath, chunk, "utf8");
    } catch (err) {
      warnOnce("appendOutput", err);
    }
  }

  function scheduleOutputFlush() {
    if (outputFlushTimer) return;
    outputFlushTimer = setTimeout(() => {
      outputFlushTimer = null;
      flushOutput();
    }, OUTPUT_FLUSH_MS);
    if (typeof outputFlushTimer.unref === "function") outputFlushTimer.unref();
  }

  writeMetaAtomic();

  const sampleInterval = setInterval(() => {
    try {
      const cum = state.tokensOut;
      const tps = cum - lastCum;
      lastCum = cum;
      appendThroughput({ t: Date.now(), tps, cum });
      state.heartbeatAt = nowBeijingIso();
      tickCount += 1;
      if (tickCount % META_REWRITE_EVERY_N_TICKS === 0) {
        writeMetaAtomic();
      }
    } catch (err) {
      console.error(
        `grokACP: Sampling ticker failed: ${err.message}\n` +
        `Task: ${taskId}\n` +
        `Throughput file: ${throughputPath}\n` +
        `Hint: Monitor may show incomplete throughput data.`,
      );
    }
  }, SAMPLE_INTERVAL_MS);
  if (typeof sampleInterval.unref === "function") sampleInterval.unref();

  function onChunk(text) {
    try {
      if (!text) return;
      state.chars += text.length;
      state.tokensOut += estimateTokens(text);
      outputBuffer += text;
      scheduleOutputFlush();
    } catch (err) {
      warnOnce(
        "onChunk",
        new Error(
          `Failed to write output chunk: ${err.message}\n` +
          `Task: ${taskId}\n` +
          `Output file: ${outputPath}\n` +
          `Hint: Check disk space and file permissions.`,
        ),
      );
    }
  }

  function onToolEvent() {
    try {
      state.resultStart = state.chars;
    } catch (err) {
      warnOnce(
        "onToolEvent",
        new Error(
          `Failed to record tool event: ${err.message}\n` +
          `Task: ${taskId}\n` +
          `Current resultStart: ${state.resultStart}\n` +
          `Hint: This is non-critical; task will continue.`,
        ),
      );
    }
  }

  function setSessionId(id) {
    try {
      state.sessionId = id || null;
      writeMetaAtomic();
    } catch (err) {
      warnOnce("setSessionId", err);
    }
  }

  function exitFinalize() {
    if (finished) return;
    finished = true;
    try {
      flushOutput();
    } catch {
      // best effort
    }
    try {
      clearInterval(sampleInterval);
    } catch {
      // best effort
    }
    try {
      const endedAt = nowBeijingIso();
      state.status = "error";
      state.error = state.error || "process exited before finish";
      state.endedAt = state.endedAt || endedAt;
      state.heartbeatAt = endedAt;
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(metaPath, JSON.stringify(state, null, 2) + "\n", "utf8");
    } catch {
      // nothing more we can do during process exit
    }
  }

  function finish(result = {}) {
    if (finished) return;
    finished = true;
    activeExitFinalizers.delete(exitFinalize);
    try {
      clearInterval(sampleInterval);
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = null;
      }
      flushOutput();

      const endedAt = nowBeijingIso();
      state.status = result.status || "done";
      state.error = result.error || null;
      state.reportPath = result.reportPath || null;
      state.jsonPath = result.jsonPath || null;
      state.context = result.context || null;
      state.endedAt = endedAt;
      state.heartbeatAt = endedAt;
      const startedMs = Date.parse(state.startedAt);
      const endedMs = Date.parse(endedAt);
      state.durationMs = Number.isFinite(startedMs) && Number.isFinite(endedMs) ? endedMs - startedMs : null;

      writeMetaAtomic();
    } catch (err) {
      console.error(
        `grokACP: Failed to write final meta.json: ${err.message}\n` +
        `Task: ${taskId}\n` +
        `Meta file: ${metaPath}\n` +
        `Hint: Task output (output.md) may still be valid; check disk space.`,
      );
    }
  }

  installExitHook();
  activeExitFinalizers.add(exitFinalize);

  return { taskId, onChunk, onToolEvent, setSessionId, finish };
}
