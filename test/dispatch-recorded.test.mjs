import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalizeFailure, resolveSessionId, toMetaContext } from "../src/dispatch-recorded.mjs";

describe("resolveSessionId", () => {
  it("prefers explicit sessionId over args.sessionId", () => {
    assert.strictEqual(resolveSessionId({ sessionId: "a", args: { sessionId: "b" } }), "a");
  });

  it("falls back to args.sessionId", () => {
    assert.strictEqual(resolveSessionId({ args: { sessionId: "b" } }), "b");
  });

  it("returns undefined when neither is set", () => {
    assert.strictEqual(resolveSessionId({}), undefined);
    assert.strictEqual(resolveSessionId({ args: {} }), undefined);
  });
});

describe("toMetaContext", () => {
  it("returns null when status is null or undefined", () => {
    assert.strictEqual(toMetaContext(null), null);
    assert.strictEqual(toMetaContext(undefined), null);
  });

  it("converts full status to TaskContext", () => {
    const status = {
      status: { level: "ok" },
      contextTokensUsed: 50000,
      contextWindowUsage: 25.0,
      contextWindowTokens: 200000,
      totalTokensBeforeCompaction: 0,
      compactionCount: 0,
    };

    const result = toMetaContext(status);

    assert.deepStrictEqual(result, {
      level: "ok",
      totalTokens: 50000,
      usagePct: 25.0,
      windowTokens: 200000,
      consumedTokens: 50000,  // 0 + 50000
      compactionCount: 0,
    });
  });

  it("handles missing contextTokensUsed (returns null for derived fields)", () => {
    const status = {
      status: { level: "watch" },
      contextWindowUsage: 60.0,
      contextWindowTokens: 200000,
      totalTokensBeforeCompaction: 100000,
      compactionCount: 2,
    };

    const result = toMetaContext(status);

    assert.strictEqual(result.level, "watch");
    assert.strictEqual(result.totalTokens, null);
    assert.strictEqual(result.consumedTokens, null);  // null + 100000 → null
    assert.strictEqual(result.compactionCount, 2);
  });

  it("calculates consumedTokens correctly after compaction", () => {
    const status = {
      status: { level: "medium" },
      contextTokensUsed: 120000,
      contextWindowUsage: 60.0,
      contextWindowTokens: 200000,
      totalTokensBeforeCompaction: 1261844,  // 8 次压缩的累计（探测任务实测值）
      compactionCount: 8,
    };

    const result = toMetaContext(status);

    assert.strictEqual(result.consumedTokens, 1381844);  // 1261844 + 120000
    assert.strictEqual(result.compactionCount, 8);
  });

  it("handles missing optional fields gracefully", () => {
    const status = {
      status: { level: "high" },
      contextTokensUsed: 150000,
      contextWindowUsage: 75.0,
      // contextWindowTokens, totalTokensBeforeCompaction, compactionCount 缺失
    };

    const result = toMetaContext(status);

    assert.strictEqual(result.level, "high");
    assert.strictEqual(result.totalTokens, 150000);
    assert.strictEqual(result.windowTokens, null);
    assert.strictEqual(result.consumedTokens, 150000);  // 0 + 150000（totalTokensBeforeCompaction 默认 0）
    assert.strictEqual(result.compactionCount, 0);  // 默认 0
  });

  it("handles status.status missing (level becomes null)", () => {
    const status = {
      contextTokensUsed: 10000,
      contextWindowUsage: 5.0,
    };

    const result = toMetaContext(status);

    assert.strictEqual(result.level, null);
    assert.strictEqual(result.totalTokens, 10000);
  });
});

describe("finalizeFailure", () => {
  function fakeRecorder() {
    const calls = [];
    return { calls, finish: (x) => calls.push(x) };
  }

  it("writes a partial report on timeout when a sessionId exists", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "grokacp-fail-"));
    const recorder = fakeRecorder();

    const { status, report } = finalizeFailure({
      recorder,
      sessionId: "019f-abc",
      text: "已完成镜像构建，正在跑 smoke",
      stderr: "",
      error: new Error("JSON-RPC session/prompt timed out after 120000ms"),
      outDir,
      name: "docker-c2c",
      model: "grok-composer-2.5-fast",
      cwd: "/repo",
      promptSource: "inline",
    });

    assert.strictEqual(status, "timeout");
    assert.ok(report, "report should be written");
    assert.ok(fs.existsSync(report.mdPath), "md file exists");
    assert.ok(fs.existsSync(report.jsonPath), "json file exists");

    const md = fs.readFileSync(report.mdPath, "utf8");
    assert.match(md, /019f-abc/, "md carries the sessionId");
    assert.match(md, /timeout/, "md marks the timeout status");
    assert.match(md, /正在跑 smoke/, "md carries the partial reply text");

    const meta = recorder.calls[0];
    assert.strictEqual(meta.status, "timeout");
    assert.strictEqual(meta.reportPath, report.mdPath);
    assert.strictEqual(meta.jsonPath, report.jsonPath);

    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("skips the report and marks 'error' when no session and no text (pre-session failure)", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "grokacp-fail-"));
    const recorder = fakeRecorder();

    const { status, report } = finalizeFailure({
      recorder,
      sessionId: null,
      text: "",
      stderr: "spawn grok ENOENT",
      error: new Error("Failed to spawn grok agent stdio: spawn grok ENOENT"),
      outDir,
      name: "no-session",
      model: "grok-composer-2.5-fast",
      cwd: "/repo",
      promptSource: "inline",
    });

    assert.strictEqual(status, "error");
    assert.strictEqual(report, null, "no report for a pre-session failure");
    assert.deepStrictEqual(fs.readdirSync(outDir), [], "outDir stays empty");

    const meta = recorder.calls[0];
    assert.strictEqual(meta.status, "error");
    assert.strictEqual(meta.reportPath, null);

    fs.rmSync(outDir, { recursive: true, force: true });
  });
});