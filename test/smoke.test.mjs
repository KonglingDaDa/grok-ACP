import { describe, it, after } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(moduleDir, "..", "bin", "grok-acp.mjs");

// smoke 会真的 spawn `grok-acp run`，写监控任务记录。绝不能污染用户真实的
// runsDir（~/.grok-acp/runs，监控面板正在看的），否则测试任务会当噪音显示。
// 用临时 GROK_ACP_HOME 把记录隔离到可丢弃目录。
const SMOKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "grok-acp-smoke-home-"));
const SMOKE_ENV = { ...process.env, GROK_ACP_HOME: SMOKE_HOME };

// smoke 需要真实 grok CLI（+ 登录态）。CI / 无 grok 的环境（GitHub ubuntu runner）里
// grok 二进制不存在，若不跳过这两个用例，`npm test` 会恒红，护栏 CI 形同虚设。
// 探测：grok 不在 PATH 上时 spawnSync 会带 error(ENOENT) → 跳过；本地有 grok 则照常跑。
function grokOnPath() {
  const probe = spawnSync("grok", ["--version"], { timeout: 5000 });
  return !probe.error;
}
const SKIP_SMOKE = grokOnPath() ? false : "grok CLI 不在 PATH（CI/无登录环境），跳过 smoke";

describe("smoke tests", () => {
  // Mirror `npm run smoke`'s ephemeral mktemp -d lifecycle: don't leave a
  // temp home in /tmp on every `npm test` run.
  after(() => {
    fs.rmSync(SMOKE_HOME, { recursive: true, force: true });
  });

  it("grok-acp run with inline prompt should succeed", { skip: SKIP_SMOKE }, () => {
    const result = spawnSync("node", [
      binPath,
      "run",
      "--prompt-text",
      "用一句中文回复：grokACP smoke ok。",
      "--cwd",
      "/home/desk/dev/repos/zq",
      "--out-dir",
      "/tmp/smoke-test-runs",
      "--timeout-ms",
      "60000",
      "--quiet"
    ], {
      encoding: "utf8",
      timeout: 70000,
      env: SMOKE_ENV
    });

    // 验证：退出码 0，stderr 包含 sessionId
    assert.strictEqual(result.status, 0, `Expected exit code 0, got ${result.status}\nStderr: ${result.stderr}\nStdout: ${result.stdout}`);
    assert.match(result.stderr, /grokACP sessionId=/, "Expected stderr to contain sessionId");
  });

  it("grok-acp doctor should succeed", { skip: SKIP_SMOKE }, () => {
    const result = spawnSync("node", [binPath, "doctor"], {
      encoding: "utf8",
      timeout: 10000,
      env: SMOKE_ENV
    });

    assert.strictEqual(result.status, 0, `doctor failed with status ${result.status}\nStderr: ${result.stderr}`);
    assert.match(result.stdout, /grok:/i, "Expected stdout to contain grok info");
  });
});