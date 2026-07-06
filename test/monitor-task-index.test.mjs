import { describe, it } from "node:test";
import assert from "node:assert";
import { computeEffectiveStatus, taskForList } from "../src/monitor-task-index.mjs";

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