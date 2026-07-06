import { describe, it } from "node:test";
import assert from "node:assert";
import { parseThroughputNdjson } from "../src/monitor-throughput.mjs";

describe("parseThroughputNdjson", () => {
  it("parses valid lines into [t, tps, cum] tuples", () => {
    const raw = '{"t":1,"tps":10,"cum":10}\n{"t":2,"tps":5,"cum":15}\n';
    assert.deepStrictEqual(parseThroughputNdjson(raw), [
      [1, 10, 10],
      [2, 5, 15],
    ]);
  });

  it("skips corrupt lines", () => {
    const raw = '{"t":1,"tps":1,"cum":1}\nnot-json\n{"t":2,"tps":2,"cum":3}\n';
    assert.deepStrictEqual(parseThroughputNdjson(raw), [
      [1, 1, 1],
      [2, 2, 3],
    ]);
  });

  it("reads from byte offset for incremental append", () => {
    const full = '{"t":1,"tps":1,"cum":1}\n{"t":2,"tps":2,"cum":3}\n';
    const offset = full.indexOf('{"t":2');
    assert.deepStrictEqual(parseThroughputNdjson(full, { fromOffset: offset }), [[2, 2, 3]]);
  });
});