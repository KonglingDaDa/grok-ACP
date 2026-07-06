#!/usr/bin/env node
// Development/verification tool: simulates grokACP task records without
// calling Grok, so the monitor UI and API can be exercised end to end.
// Schema fidelity is guaranteed by reusing src/task-recorder.mjs directly
// rather than hand-rolling a parallel writer.
import path from "node:path";
import { numberOption, parseArgs } from "../src/config.mjs";
import { createTaskRecorder } from "../src/task-recorder.mjs";

const args = parseArgs(process.argv.slice(2));

// GROK_ACP_HOME is only read lazily inside createTaskRecorder() calls below,
// so setting it here (after the static imports above) is safe.
const home = path.resolve(String(args.home || "/tmp/grok-acp-demo"));
process.env.GROK_ACP_HOME = home;

const count = numberOption(args.count, 3, "--count");
const durationMs = numberOption(args.durationMs, 60000, "--duration-ms");
const only = typeof args.only === "string" ? args.only : null;

const TARGET_CWDS = ["/home/desk/dev/repos/zq", "/home/desk/dev/repos/grokACP"];
const INVOKER_CWDS = ["/home/desk/dev/pm-project", "/home/desk/dev/repos/grokACP"];

const CN_SNIPPETS = [
  "正在分析代码库结构，定位关键模块……\n\n",
  "已找到相关函数，准备生成补丁。\n\n",
  "运行单元测试以验证改动是否安全。\n\n",
  "检查依赖关系，确认不会引入回归。\n\n",
  "生成最终报告，附带修改摘要。\n\n",
];
const CODE_SNIPPETS = [
  "```js\nexport function add(a, b) {\n  return a + b;\n}\n```\n\n",
  "```js\nif (!Number.isFinite(value)) {\n  throw new Error(\"bad value\");\n}\n```\n\n",
  "```bash\nnpm run lint && npm test\n```\n\n",
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomChunk() {
  return Math.random() < 0.65 ? pick(CN_SNIPPETS) : pick(CODE_SNIPPETS);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

async function runLongTask() {
  const recorder = createTaskRecorder({
    command: "run",
    name: "fake-long-running-task",
    prompt:
      "【模拟任务】长时间运行的示例任务，持续产出中文与代码混合正文，用于验证吞吐折线图、心跳与 RUNNING 卡片。",
    model: "grok-composer-2.5-fast",
    targetCwd: TARGET_CWDS[0],
    invokerCwd: INVOKER_CWDS[0],
  });
  recorder.setSessionId(`fake-session-${recorder.taskId}`);

  const endAt = Date.now() + durationMs;
  while (Date.now() < endAt) {
    await sleep(Math.min(400 + Math.random() * 900, endAt - Date.now()));
    if (Date.now() >= endAt) break;
    if (Math.random() < 0.2) continue; // occasional stall -> visible tps:0 dip
    recorder.onChunk(randomChunk());
  }

  recorder.finish({
    status: "done",
    context: { level: "ok", totalTokens: 42000, usagePct: 21 },
  });
}

async function runDoneTask(index) {
  const startDelay = Math.random() * Math.max(0, durationMs - 4000);
  await sleep(startDelay);

  const recorder = createTaskRecorder({
    command: index % 2 === 0 ? "run" : "compact",
    name: `fake-done-task-${index + 1}`,
    prompt: `【模拟任务】第 ${index + 1} 个已完成任务，用于验证紧凑卡片、静态迷你图与分页。`,
    model: "grok-composer-2.5-fast",
    targetCwd: TARGET_CWDS[index % TARGET_CWDS.length],
    invokerCwd: INVOKER_CWDS[index % INVOKER_CWDS.length],
  });
  recorder.setSessionId(`fake-session-${recorder.taskId}`);

  const ticks = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < ticks; i += 1) {
    await sleep(400 + Math.random() * 600);
    if (Math.random() < 0.15) continue;
    recorder.onChunk(randomChunk());
  }

  recorder.finish({
    status: "done",
    context: { level: "watch", totalTokens: 105000, usagePct: 68 },
  });
}

async function runErrorTask() {
  const startDelay = Math.random() * Math.max(0, durationMs - 3000);
  await sleep(startDelay);

  const recorder = createTaskRecorder({
    command: "run",
    name: "fake-error-task",
    prompt: "【模拟任务】模拟执行失败的任务，用于验证 ERROR 卡片与错误文案展示。",
    model: "grok-composer-2.5-fast",
    targetCwd: TARGET_CWDS[1 % TARGET_CWDS.length],
    invokerCwd: INVOKER_CWDS[0],
  });
  recorder.setSessionId(`fake-session-${recorder.taskId}`);

  await sleep(500);
  recorder.onChunk(pick(CN_SNIPPETS));
  await sleep(600);
  recorder.onChunk("正在执行工具调用……\n\n");
  await sleep(500);

  recorder.finish({
    status: "error",
    error: "模拟失败：grok agent stdio 退出 code=1 signal=null",
  });
}

async function main() {
  console.error(`grokACP fake-task: home=${home}`);

  if (only === "long") {
    console.error(`grokACP fake-task: long-running only for ${durationMs}ms`);
    await runLongTask();
    console.error("grokACP fake-task: finished");
    return;
  }

  console.error(
    `grokACP fake-task: spawning 1 long-running + ${count} done + 1 error task(s) across ${TARGET_CWDS.length} targetCwd(s) for ${durationMs}ms`,
  );

  const jobs = [runLongTask(), runErrorTask()];
  for (let i = 0; i < count; i += 1) {
    jobs.push(runDoneTask(i));
  }

  await Promise.all(jobs);
  console.error("grokACP fake-task: finished");
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
