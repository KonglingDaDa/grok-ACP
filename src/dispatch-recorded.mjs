import path from "node:path";
import { GrokAcpClient } from "./acp-client.mjs";
import { boolOption, DEFAULT_TIMEOUT_MS, numberOption } from "./config.mjs";
import { writeRunReport } from "./report.mjs";
import { getSessionStatus, renderStatus } from "./session-store.mjs";
import { getRunsDir } from "./paths.mjs";
import { cleanupOldRuns, createTaskRecorder } from "./task-recorder.mjs";

export function cleanupRunsBestEffort() {
  try {
    cleanupOldRuns(getRunsDir(), 7);
  } catch {
    // monitoring cleanup must never affect run/compact
  }
}

/** Single source for session id: explicit option wins over --session-id flag. */
export function resolveSessionId({ sessionId, args } = {}) {
  const id = sessionId ?? args?.sessionId;
  if (id === undefined || id === true || id === "") return undefined;
  return String(id);
}

/**
 * 将 Grok session status 转换为监控 UI 的 TaskContext 对象。
 */
export function toMetaContext(status) {
  if (!status) return null;
  const used = status.contextTokensUsed ?? null;
  const compactedBefore = status.totalTokensBeforeCompaction ?? 0;
  return {
    level: status.status?.level ?? null,
    totalTokens: used,
    usagePct: status.contextWindowUsage ?? null,
    windowTokens: status.contextWindowTokens ?? null,
    consumedTokens: used === null ? null : used + compactedBefore,
    compactionCount: status.compactionCount ?? 0,
  };
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 失败/超时收尾：写部分回执 + 记录 recorder 终态。抽成纯函数便于单测。
 *
 * 判定 status：错误信息含 "timed out" → "timeout"，否则 "error"。
 * 仅当 sessionId 或已累积文本存在时才写部分报告 —— 避免 spawn/auth 等 session 前
 * 失败产出空垃圾报告。写报告复用 writeRunReport，传入手搓的部分 result。
 *
 * @returns {{ status: string, report: {mdPath:string, jsonPath:string} | null }}
 */
export function finalizeFailure({ recorder, sessionId, text, stderr, error, outDir, name, model, cwd, promptSource }) {
  const message = errorMessage(error);
  const status = /timed out/i.test(message) ? "timeout" : "error";
  const hasContent = Boolean(sessionId) || Boolean(text && text.length > 0);

  let report = null;
  if (hasContent) {
    report = writeRunReport({
      outDir,
      name,
      model,
      cwd,
      promptSource,
      result: {
        sessionId: sessionId ?? undefined,
        text: text ?? "",
        stderr: stderr ?? "",
        authMethod: null,
        promptResult: null,
        status,
        error: message,
      },
    });
  }

  recorder.finish({
    status,
    error: message,
    reportPath: report?.mdPath ?? null,
    jsonPath: report?.jsonPath ?? null,
  });

  return { status, report };
}

export function makeGrokClient(args, { model, cwd, onChunk, onToolEvent, onSession } = {}) {
  return new GrokAcpClient({
    grokBin: String(args.grokBin || "grok"),
    model,
    cwd,
    noAutoUpdate: !boolOption(args.allowAutoUpdate, false),
    alwaysApprove: true,
    debug: boolOption(args.debug, false),
    debugFile: args.debugFile ? String(args.debugFile) : undefined,
    leaderSocket: args.leaderSocket ? String(args.leaderSocket) : undefined,
    onChunk,
    onToolEvent,
    onSession,
  });
}

function stableRunOptions(args, { cwd, timeoutMs, sessionId }) {
  return {
    cwd,
    timeoutMs,
    stableIntervalMs: numberOption(args.stableIntervalMs, 150, "--stable-interval-ms"),
    stableChecks: numberOption(args.stableChecks, 2, "--stable-checks"),
    stableMaxWaitMs: numberOption(args.stableMaxWaitMs, 10000, "--stable-max-wait-ms"),
    sessionId,
  };
}

/**
 * Shared run orchestration: recorder + ACP client + finish on success/error.
 */
export async function dispatchRecordedPrompt({
  args,
  command,
  name,
  promptText,
  promptSource,
  cwd,
  model,
  outDir,
  sessionId: sessionIdOption,
  enrichResult,
}) {
  cleanupRunsBestEffort();

  const sessionId = resolveSessionId({ sessionId: sessionIdOption, args });

  const recorder = createTaskRecorder({
    command,
    name,
    prompt: promptText,
    model,
    targetCwd: cwd,
    invokerCwd: process.cwd(),
  });

  console.error(`grokACP taskId=${recorder.taskId}`);
  console.error(`grokACP runsDir=${getRunsDir()}`);

  if (sessionId) recorder.setSessionId(sessionId);

  const client = makeGrokClient(args, {
    model,
    cwd,
    onChunk: recorder.onChunk,
    onToolEvent: recorder.onToolEvent,
    onSession: (id) => {
      // session 一创建就落 meta + 打印，使后续任何超时都能凭此 id 续跑
      recorder.setSessionId(id);
      console.error(`grokACP sessionId=${id}`);
    },
  });
  const timeoutMs = numberOption(args.timeoutMs, DEFAULT_TIMEOUT_MS, "--timeout-ms");

  try {
    const result = await client.runPrompt(
      promptText,
      stableRunOptions(args, { cwd, timeoutMs, sessionId }),
    );

    if (!sessionId) recorder.setSessionId(result.sessionId);

    let context = null;
    try {
      context = toMetaContext(getSessionStatus({ cwd, sessionId: result.sessionId }));
    } catch {
      context = null;
    }

    const reportResult = enrichResult ? enrichResult(result) : result;
    const report = writeRunReport({
      outDir,
      name,
      model,
      cwd,
      promptSource,
      result: reportResult,
    });

    recorder.finish({
      status: "done",
      reportPath: report.mdPath,
      jsonPath: report.jsonPath,
      context,
    });

    return { result, report, context };
  } catch (error) {
    const sessionId = client.sessionId;
    const { status, report } = finalizeFailure({
      recorder,
      sessionId,
      text: client.text,
      stderr: client.stderr,
      error,
      outDir,
      name,
      model,
      cwd,
      promptSource,
    });

    // 续跑线索：超时 ≠ 失败。让 PM 无需去 ~/.grok-acp/runs 考古。
    console.error(`grokACP status=${status}`);
    if (report) {
      console.error(`grokACP partial-report=${report.mdPath}`);
      console.error(`grokACP partial-json=${report.jsonPath}`);
    }
    if (sessionId) {
      console.error(
        `grokACP resume-hint=grok-acp run --session-id ${sessionId} --timeout-ms 1800000 --prompt-file <continuation>`,
      );
    }

    if (status === "timeout") error.isTimeout = true;
    error.resume = { sessionId: sessionId ?? null, mdPath: report?.mdPath ?? null };
    throw error;
  } finally {
    client.close();
  }
}

/** Compact-specific wrapper: enriches report with before/after context blocks. */
export async function dispatchCompact({
  args,
  cwd,
  model,
  outDir,
  sessionId,
  compactSuffix = "",
  before,
}) {
  const name = args.name || `compact-${sessionId}`;
  const promptText = `/compact${compactSuffix}`;

  return dispatchRecordedPrompt({
    args,
    command: "compact",
    name,
    promptText,
    promptSource: promptText,
    cwd,
    model,
    outDir,
    sessionId,
    enrichResult(result) {
      const after = getSessionStatus({ cwd, sessionId });
      return {
        ...result,
        text: `${result.text || "_No compact text returned by ACP._"}\n\n## Context Before\n\n\`\`\`text\n${renderStatus(before)}\n\`\`\`\n\n## Context After\n\n\`\`\`text\n${renderStatus(after)}\n\`\`\``,
      };
    },
  });
}