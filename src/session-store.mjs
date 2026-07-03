import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function getSessionStatus(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const sessionId = options.sessionId || findLatestSessionId(cwd);
  if (!sessionId) {
    throw new Error(`No Grok session found for cwd: ${cwd}`);
  }

  const sessionDir = getSessionDir(cwd, sessionId);
  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Grok session directory not found: ${sessionDir}`);
  }

  const signals = readJsonIfExists(path.join(sessionDir, "signals.json"));
  const summary = readJsonIfExists(path.join(sessionDir, "summary.json"));
  const promptContext = readJsonIfExists(path.join(sessionDir, "prompt_context.json"));
  const chatHistoryPath = path.join(sessionDir, "chat_history.jsonl");
  const updateStats = readUpdateStats(path.join(sessionDir, "updates.jsonl"));

  const contextTokensUsed = numberOrNull(signals?.contextTokensUsed);
  const contextWindowTokens = numberOrNull(signals?.contextWindowTokens);
  const contextWindowUsage =
    numberOrNull(signals?.contextWindowUsage) ??
    (contextTokensUsed !== null && contextWindowTokens ? Math.round((contextTokensUsed / contextWindowTokens) * 100) : null);

  return {
    sessionId,
    cwd,
    sessionDir,
    modelId: summary?.current_model_id || signals?.primaryModelId || null,
    agentName: summary?.agent_name || null,
    createdAt: summary?.created_at || null,
    updatedAt: summary?.updated_at || null,
    numMessages: summary?.num_messages ?? null,
    numChatMessages: summary?.num_chat_messages ?? countJsonl(chatHistoryPath),
    contextTokensUsed,
    contextWindowTokens,
    contextWindowUsage,
    compactionCount: maxNumber(numberOrNull(signals?.compactionCount), updateStats.compactionCount),
    totalTokensBeforeCompaction: maxNumber(numberOrNull(signals?.totalTokensBeforeCompaction), updateStats.lastTokensBeforeCompaction),
    lastTokensAfterCompaction: updateStats.lastTokensAfterCompaction,
    lastCompactionAt: updateStats.lastCompactionAt,
    turnCount: numberOrNull(signals?.turnCount),
    toolCallCount: numberOrNull(signals?.toolCallCount),
    toolsUsed: Array.isArray(signals?.toolsUsed) ? signals.toolsUsed : [],
    promptMode: promptContext?.prompt_mode || null,
    status: classifyContext(contextTokensUsed, contextWindowUsage),
  };
}

export function findLatestSessionId(cwd) {
  const root = getSessionsRoot(cwd);
  if (!fs.existsSync(root)) return null;

  const candidates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const sessionDir = path.join(root, entry.name);
      const summary = readJsonIfExists(path.join(sessionDir, "summary.json"));
      const updatedAt = summary?.updated_at || summary?.last_active_at || "1970-01-01T00:00:00Z";
      return { sessionId: entry.name, updatedAt };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  return candidates[0]?.sessionId || null;
}

export function getSessionDir(cwd, sessionId) {
  return path.join(getSessionsRoot(cwd), sessionId);
}

export function getSessionsRoot(cwd) {
  return path.join(os.homedir(), ".grok", "sessions", encodeURIComponent(path.resolve(cwd)));
}

export function renderStatus(status) {
  return `session_id: ${status.sessionId}
cwd: ${status.cwd}
model_id: ${status.modelId || "unknown"}
agent_name: ${status.agentName || "unknown"}
updated_at: ${status.updatedAt || "unknown"}
messages: ${status.numMessages ?? "unknown"} (${status.numChatMessages ?? "unknown"} chat records)
context_tokens_used: ${status.contextTokensUsed ?? "unknown"}
context_window_tokens: ${status.contextWindowTokens ?? "unknown"}
context_window_usage_percent: ${status.contextWindowUsage ?? "unknown"}
compaction_count: ${status.compactionCount ?? "unknown"}
last_compaction_at: ${status.lastCompactionAt || "never"}
last_tokens_before_compaction: ${status.totalTokensBeforeCompaction ?? "unknown"}
last_tokens_after_compaction: ${status.lastTokensAfterCompaction ?? "unknown"}
tool_call_count: ${status.toolCallCount ?? "unknown"}
recommendation: ${status.status.recommendation}
reason: ${status.status.reason}`;
}

function classifyContext(tokens, usagePercent) {
  if ((usagePercent !== null && usagePercent >= 85) || (tokens !== null && tokens >= 170000)) {
    return {
      level: "critical",
      recommendation: "do not dispatch business work; compact or start a new session first",
      reason: "context is at or above the hard stop threshold",
    };
  }
  if ((usagePercent !== null && usagePercent >= 75) || (tokens !== null && tokens >= 150000)) {
    return {
      level: "high",
      recommendation: "compact or start a new session before the next task",
      reason: "context is above the forced refresh threshold",
    };
  }
  if (tokens !== null && tokens >= 120000) {
    return {
      level: "medium",
      recommendation: "compact or start a new session before non-trivial work",
      reason: "context is above the PM 120k threshold",
    };
  }
  if (tokens !== null && tokens >= 100000) {
    return {
      level: "watch",
      recommendation: "only dispatch short tasks",
      reason: "context is approaching the PM 120k threshold",
    };
  }
  return {
    level: "ok",
    recommendation: "safe for ordinary small tasks",
    reason: "context is below PM thresholds",
  };
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function countJsonl(file) {
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, "utf8").trim();
  if (!content) return 0;
  return content.split("\n").length;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function maxNumber(...values) {
  const numbers = values.filter(value => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return Math.max(...numbers);
}

function readUpdateStats(file) {
  if (!fs.existsSync(file)) {
    return {
      compactionCount: null,
      lastTokensBeforeCompaction: null,
      lastTokensAfterCompaction: null,
      lastCompactionAt: null,
    };
  }

  let compactionCount = 0;
  let lastTokensBeforeCompaction = null;
  let lastTokensAfterCompaction = null;
  let lastCompactionAt = null;
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const update = entry.params?.update;
    if (!update) continue;
    if (update.sessionUpdate === "auto_compact_completed") {
      compactionCount += 1;
      lastTokensBeforeCompaction = numberOrNull(update.tokens_before);
      lastTokensAfterCompaction = numberOrNull(update.tokens_after);
      lastCompactionAt = entry.timestamp ? new Date(entry.timestamp * 1000).toISOString() : null;
    }
    if (update.sessionUpdate === "compaction_checkpoint") {
      lastCompactionAt = update.created_at || lastCompactionAt;
    }
  }

  return {
    compactionCount: compactionCount || null,
    lastTokensBeforeCompaction,
    lastTokensAfterCompaction,
    lastCompactionAt,
  };
}
