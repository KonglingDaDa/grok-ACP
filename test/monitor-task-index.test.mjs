import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeEffectiveStatus, taskForList, createTaskIndex } from "../src/monitor-task-index.mjs";

describe("computeEffectiveStatus", () => {
  it("returns persisted status when not running", () => {
    assert.strictEqual(computeEffectiveStatus({ status: "done" }), "done");
    assert.strictEqual(computeEffectiveStatus({ status: "error" }), "error");
  });

  it("returns running when pid is alive and heartbeat is fresh", () => {
    const meta = {
      status: "running",
      pid: process.pid,
      heartbeatAt: new Date().toISOString(),
    };
    assert.strictEqual(computeEffectiveStatus(meta), "running");
  });

  it("returns interrupted when heartbeat is stale", () => {
    const meta = {
      status: "running",
      pid: process.pid,
      heartbeatAt: new Date(Date.now() - 60_000).toISOString(),
    };
    assert.strictEqual(computeEffectiveStatus(meta), "interrupted");
  });

  it("returns interrupted when pid is not alive", () => {
    const meta = {
      status: "running",
      pid: 999_999_999,
      heartbeatAt: new Date().toISOString(),
    };
    assert.strictEqual(computeEffectiveStatus(meta), "interrupted");
  });
});

describe("taskForList", () => {
  it("omits full prompt and adds effectiveStatus", () => {
    const meta = {
      id: "t1",
      prompt: "secret full prompt",
      promptPreview: "secret",
      status: "done",
    };
    const list = taskForList(meta, "done");
    assert.strictEqual(list.effectiveStatus, "done");
    assert.strictEqual(list.promptPreview, "secret");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(list, "prompt"), false);
  });
});

describe("createTaskIndex refreshRunningTasks (self-heal)", () => {
  function writeMeta(runsDir, taskId, meta) {
    const dir = path.join(runsDir, taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id: taskId, ...meta }), "utf8");
    return dir;
  }

  it("recovers a completed-but-missed task from interrupted to done by re-reading disk", () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-idx-"));
    const broadcasts = [];
    const index = createTaskIndex(runsDir, { onTask: (t) => broadcasts.push(t), onSample: () => {} });
    try {
      // Indexed while "running" with a dead pid -> effectiveStatus interrupted.
      writeMeta(runsDir, "t1", { status: "running", pid: 999_999_999, heartbeatAt: new Date().toISOString() });
      index.upsertTask("t1", { broadcast: false });
      assert.strictEqual(index.tasksById.get("t1").effectiveStatus, "interrupted");

      // The run actually finished: terminal status hits disk, but the cached
      // meta is stale (fs.watch dropped the event).
      writeMeta(runsDir, "t1", { status: "done", pid: 999_999_999, endedAt: new Date().toISOString() });

      index.refreshRunningTasks();

      assert.strictEqual(index.tasksById.get("t1").effectiveStatus, "done", "should self-heal to done");
      assert.ok(
        broadcasts.some((t) => t.id === "t1" && t.effectiveStatus === "done"),
        "should broadcast the corrected done status",
      );
    } finally {
      index.closeAllWatchers();
      fs.rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it("keeps a genuinely dead run as interrupted (disk still running, pid gone)", () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-idx-"));
    const index = createTaskIndex(runsDir, { onTask: () => {}, onSample: () => {} });
    try {
      writeMeta(runsDir, "t2", { status: "running", pid: 999_999_999, heartbeatAt: new Date().toISOString() });
      index.upsertTask("t2", { broadcast: false });

      index.refreshRunningTasks();

      assert.strictEqual(index.tasksById.get("t2").effectiveStatus, "interrupted");
    } finally {
      index.closeAllWatchers();
      fs.rmSync(runsDir, { recursive: true, force: true });
    }
  });
});