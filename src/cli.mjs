import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_ZQ_CWD,
  boolOption,
  numberOption,
  parseArgs,
  readPrompt,
} from "./config.mjs";
import { dispatchCompact, dispatchRecordedPrompt, makeGrokClient } from "./dispatch-recorded.mjs";
import { getSessionStatus, renderStatus } from "./session-store.mjs";
import { startMonitorServer } from "./monitor-server.mjs";

export async function main(argv) {
  const [command = "help", ...rest] = argv;

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "doctor") {
    doctor(parseArgs(rest));
    return;
  }
  if (command === "run") {
    await run(parseArgs(rest));
    return;
  }
  if (command === "new") {
    await newSession(parseArgs(rest));
    return;
  }
  if (command === "status") {
    status(parseArgs(rest));
    return;
  }
  if (command === "compact") {
    await compact(parseArgs(rest));
    return;
  }
  if (command === "ui") {
    await ui(parseArgs(rest));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function run(args) {
  const cwd = path.resolve(String(args.cwd || DEFAULT_ZQ_CWD));
  const model = String(args.model || DEFAULT_MODEL);
  const outDir = path.resolve(String(args.outDir || path.join(cwd, ".codex-artifacts", "grok-acp-runs")));
  const prompt = readPrompt(args);
  const quiet = boolOption(args.quiet, false);
  const name = args.name || path.basename(prompt.source).replace(/\.[^.]+$/, "");

  const { result, report } = await dispatchRecordedPrompt({
    args,
    command: "run",
    name,
    promptText: prompt.text,
    promptSource: prompt.source,
    cwd,
    model,
    outDir,
  });

  if (!quiet && result.text) {
    console.log(result.text);
  }
  console.error(`grokACP sessionId=${result.sessionId}`);
  console.error(`grokACP report=${report.mdPath}`);
  console.error(`grokACP json=${report.jsonPath}`);
}

async function newSession(args) {
  const cwd = path.resolve(String(args.cwd || DEFAULT_ZQ_CWD));
  const model = String(args.model || DEFAULT_MODEL);
  const timeoutMs = numberOption(args.timeoutMs, DEFAULT_TIMEOUT_MS, "--timeout-ms");
  const client = makeGrokClient(args, { model, cwd });

  try {
    const result = await client.newSession({ cwd, timeoutMs });
    console.log(result.sessionId);
  } finally {
    client.close();
  }
}

function status(args) {
  const cwd = path.resolve(String(args.cwd || DEFAULT_ZQ_CWD));
  const current = getSessionStatus({
    cwd,
    sessionId: args.sessionId ? String(args.sessionId) : undefined,
  });

  if (boolOption(args.json, false)) {
    console.log(JSON.stringify(current, null, 2));
    return;
  }

  console.log(renderStatus(current));
}

async function compact(args) {
  const cwd = path.resolve(String(args.cwd || DEFAULT_ZQ_CWD));
  const model = String(args.model || DEFAULT_MODEL);
  const sessionId = String(args.sessionId || getSessionStatus({ cwd }).sessionId);
  const compactSuffix = typeof args.context === "string" ? ` ${args.context}` : "";
  const outDir = path.resolve(String(args.outDir || path.join(cwd, ".codex-artifacts", "grok-acp-runs")));
  const before = getSessionStatus({ cwd, sessionId });

  const { report } = await dispatchCompact({
    args,
    cwd,
    model,
    outDir,
    sessionId,
    compactSuffix,
    before,
  });

  console.error(`grokACP compact sessionId=${sessionId}`);
  console.error(`grokACP report=${report.mdPath}`);
  console.error(`grokACP json=${report.jsonPath}`);
  console.log(renderStatus(getSessionStatus({ cwd, sessionId })));
}

async function ui(args) {
  const port = numberOption(args.port, 41730, "--port");
  const host = String(args.host || "127.0.0.1");
  await startMonitorServer({ port, host });
}

function doctor(args) {
  const grokBin = String(args.grokBin || "grok");
  const version = spawnSync(grokBin, ["--no-auto-update", "--version"], { encoding: "utf8" });
  if (version.error || version.status !== 0) {
    throw new Error(`Cannot run ${grokBin}: ${version.error?.message || version.stderr}`);
  }

  const stdioHelp = spawnSync(grokBin, ["--no-auto-update", "agent", "--always-approve", "--model", DEFAULT_MODEL, "stdio", "--help"], { encoding: "utf8" });
  if (stdioHelp.error || stdioHelp.status !== 0) {
    throw new Error(`Cannot run ${grokBin} agent stdio: ${stdioHelp.error?.message || stdioHelp.stderr}`);
  }

  console.log(`grok: ${version.stdout.trim()}`);
  console.log("agent stdio: ok");
  console.log("always approve: enabled by default");
  console.log("session load: supported by Grok ACP initialize when agentCapabilities.loadSession=true");
  console.log(`default model: ${DEFAULT_MODEL}`);
  console.log(`default cwd: ${DEFAULT_ZQ_CWD}`);
}

function printHelp() {
  console.log(`grokACP - thin Grok CLI ACP dispatcher

Usage:
  grok-acp doctor [--grok-bin grok]
  grok-acp run --prompt-file <path> [options]
  grok-acp run --prompt-text <text> [options]
  grok-acp status [--cwd <path>] [--session-id <id>] [--json]
  grok-acp compact [--cwd <path>] [--session-id <id>] [--context <text>]
  grok-acp new [--cwd <path>]
  grok-acp ui [--port 41730] [--host 127.0.0.1]

Run options:
  --cwd <path>                 Working directory passed to session/new
  --model <id>                 Grok agent model, default ${DEFAULT_MODEL}
  --out-dir <path>             Report directory, default <cwd>/.codex-artifacts/grok-acp-runs
  --timeout-ms <number>        JSON-RPC request timeout, default ${DEFAULT_TIMEOUT_MS}
  --name <name>                Report filename suffix
  --quiet                      Do not print Grok reply to stdout
  --session-id <id>            Send prompt to an existing Grok session
  --debug                      Pass --debug to grok agent stdio
  --debug-file <path>          Pass --debug-file to grok agent stdio
  --leader-socket <path>       Pass --leader-socket to grok agent stdio
  --grok-bin <path>            Grok executable, default grok

UI options:
  --port <number>              Monitor server port, default 41730
  --host <address>             Monitor server bind host, default 127.0.0.1

All ACP starts include --always-approve by default. The actual command shape is:
  grok --no-auto-update agent --always-approve --model <model> stdio

'run' and 'compact' record task metadata, throughput samples, and streamed
output under $GROK_ACP_HOME (default ~/.grok-acp), retained for 7 days.
'grok-acp new' does not write monitor records. Use the same $GROK_ACP_HOME
for 'run'/'compact' and 'ui' or tasks will not appear in the dashboard.
'grok-acp ui' serves a local, read-only dashboard over that data at
http://<host>:<port>. Build the frontend once with 'npm run ui:build'.
`);
}