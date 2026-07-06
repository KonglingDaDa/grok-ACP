import { describe, it } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(moduleDir, "..", "bin", "grok-acp.mjs");

describe("smoke tests", () => {
  it("grok-acp run with inline prompt should succeed", () => {
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
      timeout: 70000
    });

    // 验证：退出码 0，stderr 包含 sessionId
    assert.strictEqual(result.status, 0, `Expected exit code 0, got ${result.status}\nStderr: ${result.stderr}\nStdout: ${result.stdout}`);
    assert.match(result.stderr, /grokACP sessionId=/, "Expected stderr to contain sessionId");
  });

  it("grok-acp doctor should succeed", () => {
    const result = spawnSync("node", [binPath, "doctor"], {
      encoding: "utf8",
      timeout: 10000
    });

    assert.strictEqual(result.status, 0, `doctor failed with status ${result.status}\nStderr: ${result.stderr}`);
    assert.match(result.stdout, /grok:/i, "Expected stdout to contain grok info");
  });
});