import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupOldRuns, createTaskRecorder } from "../src/task-recorder.mjs";

const NINE_DAYS_MS = 9 * 24 * 60 * 60 * 1000;

describe("cleanupOldRuns", () => {
  it("returns removed ids, deletes expired dirs, keeps recent dirs", () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-acp-runs-"));
    const expiredId = "expired-task";
    const recentId = "recent-task";
    const nineDaysAgo = new Date(Date.now() - NINE_DAYS_MS).toISOString();

    fs.mkdirSync(path.join(runsDir, expiredId), { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, expiredId, "meta.json"),
      JSON.stringify({ startedAt: nineDaysAgo }) + "\n",
    );

    fs.mkdirSync(path.join(runsDir, recentId), { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, recentId, "meta.json"),
      JSON.stringify({ startedAt: new Date().toISOString() }) + "\n",
    );

    const removed = cleanupOldRuns(runsDir, 7);

    assert.deepStrictEqual(removed, [expiredId]);
    assert.strictEqual(fs.existsSync(path.join(runsDir, expiredId)), false);
    assert.strictEqual(fs.existsSync(path.join(runsDir, recentId)), true);

    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it("returns empty array when runsDir is missing", () => {
    const missing = path.join(os.tmpdir(), `grok-acp-missing-${Date.now()}`);
    assert.deepStrictEqual(cleanupOldRuns(missing, 7), []);
  });
});

describe("createTaskRecorder onToolEvent counting", () => {
  it("counts distinct tool_call events but not tool_call_update ticks", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-acp-rec-"));
    const prevHome = process.env.GROK_ACP_HOME;
    process.env.GROK_ACP_HOME = home;
    try {
      const recorder = createTaskRecorder({ command: "run", name: "count-test" });
      recorder.onToolEvent("tool_call");
      recorder.onToolEvent("tool_call_update"); // progress tick — must not count
      recorder.onToolEvent("tool_call_update");
      recorder.onToolEvent("tool_call");
      recorder.finish({ status: "done" });

      const metaPath = path.join(home, "runs", recorder.taskId, "meta.json");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      assert.strictEqual(meta.toolCallCount, 2, "only tool_call events count");
    } finally {
      if (prevHome === undefined) delete process.env.GROK_ACP_HOME;
      else process.env.GROK_ACP_HOME = prevHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});