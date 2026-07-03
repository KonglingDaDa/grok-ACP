import { spawnSync } from "node:child_process";
import path from "node:path";
import { GrokAcpClient } from "./acp-client.mjs";
import {
  DEFAULT_MODEL,
  DEFAULT_ZQ_CWD,
  boolOption,
  numberOption,
  parseArgs,
  readPrompt,
} from "./config.mjs";
import { writeRunReport } from "./report.mjs";
import { getSessionStatus, renderStatus } from "./session-store.mjs";

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

  throw new Error(`Unknown command: ${command}`);
}

async function run(args) {
  const cwd = path.resolve(String(args.cwd || DEFAULT_ZQ_CWD));
  const model = String(args.model || DEFAULT_MODEL);
  const outDir = path.resolve(String(args.outDir || path.join(cwd, ".codex-artifacts", "grok-acp-runs")));
  const timeoutMs = numberOption(args.timeoutMs, 120000, "--timeout-ms");
  const prompt = readPrompt(args);
  const quiet = boolOption(args.quiet, false);

  const client = new GrokAcpClient({
    grokBin: String(args.grokBin || "grok"),
    model,
    cwd,
    noAutoUpdate: !boolOption(args.allowAutoUpdate, false),
    alwaysApprove: true,
    debug: boolOption(args.debug, false),
    debugFile: args.debugFile ? String(args.debugFile) : undefined,
    leaderSocket: args.leaderSocket ? String(args.leaderSocket) : undefined,
  });

  try {
    const result = await client.runPrompt(prompt.text, {
      cwd,
      timeoutMs,
      stableIntervalMs: numberOption(args.stableIntervalMs, 150, "--stable-interval-ms"),
      stableChecks: numberOption(args.stableChecks, 2, "--stable-checks"),
      stableMaxWaitMs: numberOption(args.stableMaxWaitMs, 10000, "--stable-max-wait-ms"),
      sessionId: args.sessionId ? String(args.sessionId) : undefined,
    });

    const report = writeRunReport({
      outDir,
      name: args.name || path.basename(prompt.source).replace(/\.[^.]+$/, ""),
      model,
      cwd,
      promptSource: prompt.source,
      result,
    });

    if (!quiet && result.text) {
      console.log(result.text);
    }
    console.error(`grokACP sessionId=${result.sessionId}`);
    console.error(`grokACP report=${report.mdPath}`);
    console.error(`grokACP json=${report.jsonPath}`);
  } finally {
    client.close();
  }
}

async function newSession(args) {
  const cwd = path.resolve(String(args.cwd || DEFAULT_ZQ_CWD));
  const model = String(args.model || DEFAULT_MODEL);
  const timeoutMs = numberOption(args.timeoutMs, 120000, "--timeout-ms");
  const client = new GrokAcpClient({
    grokBin: String(args.grokBin || "grok"),
    model,
    cwd,
    noAutoUpdate: !boolOption(args.allowAutoUpdate, false),
    alwaysApprove: true,
    debug: boolOption(args.debug, false),
    debugFile: args.debugFile ? String(args.debugFile) : undefined,
    leaderSocket: args.leaderSocket ? String(args.leaderSocket) : undefined,
  });

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
  const timeoutMs = numberOption(args.timeoutMs, 120000, "--timeout-ms");
  const context = typeof args.context === "string" ? ` ${args.context}` : "";
  const outDir = path.resolve(String(args.outDir || path.join(cwd, ".codex-artifacts", "grok-acp-runs")));
  const before = getSessionStatus({ cwd, sessionId });

  const client = new GrokAcpClient({
    grokBin: String(args.grokBin || "grok"),
    model,
    cwd,
    noAutoUpdate: !boolOption(args.allowAutoUpdate, false),
    alwaysApprove: true,
    debug: boolOption(args.debug, false),
    debugFile: args.debugFile ? String(args.debugFile) : undefined,
    leaderSocket: args.leaderSocket ? String(args.leaderSocket) : undefined,
  });

  try {
    const result = await client.runPrompt(`/compact${context}`, {
      cwd,
      timeoutMs,
      stableIntervalMs: numberOption(args.stableIntervalMs, 150, "--stable-interval-ms"),
      stableChecks: numberOption(args.stableChecks, 2, "--stable-checks"),
      stableMaxWaitMs: numberOption(args.stableMaxWaitMs, 10000, "--stable-max-wait-ms"),
      sessionId,
    });
    const after = getSessionStatus({ cwd, sessionId });
    const report = writeRunReport({
      outDir,
      name: args.name || `compact-${sessionId}`,
      model,
      cwd,
      promptSource: `/compact${context}`,
      result: {
        ...result,
        text: `${result.text || "_No compact text returned by ACP._"}\n\n## Context Before\n\n\`\`\`text\n${renderStatus(before)}\n\`\`\`\n\n## Context After\n\n\`\`\`text\n${renderStatus(after)}\n\`\`\``,
      },
    });
    console.error(`grokACP compact sessionId=${sessionId}`);
    console.error(`grokACP report=${report.mdPath}`);
    console.error(`grokACP json=${report.jsonPath}`);
    console.log(renderStatus(after));
  } finally {
    client.close();
  }
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

Run options:
  --cwd <path>                 Working directory passed to session/new
  --model <id>                 Grok agent model, default ${DEFAULT_MODEL}
  --out-dir <path>             Report directory, default <cwd>/.codex-artifacts/grok-acp-runs
  --timeout-ms <number>        JSON-RPC request timeout, default 120000
  --name <name>                Report filename suffix
  --quiet                      Do not print Grok reply to stdout
  --session-id <id>            Send prompt to an existing Grok session
  --debug                      Pass --debug to grok agent stdio
  --debug-file <path>          Pass --debug-file to grok agent stdio
  --leader-socket <path>       Pass --leader-socket to grok agent stdio
  --grok-bin <path>            Grok executable, default grok

All ACP starts include --always-approve by default. The actual command shape is:
  grok --no-auto-update agent --always-approve --model <model> stdio
`);
}
