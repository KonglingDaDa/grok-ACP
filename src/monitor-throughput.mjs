/**
 * Parse throughput.ndjson lines into [epochMs, tps, cumulativeTokens] tuples.
 * Shared by monitor-routes (full read) and monitor-task-index (offset incremental read).
 */
export function parseThroughputNdjson(raw, { fromOffset = 0 } = {}) {
  const slice = fromOffset > 0 ? raw.slice(fromOffset) : raw;
  const samples = [];
  for (const line of slice.split("\n")) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      samples.push([obj.t, obj.tps, obj.cum]);
    } catch {
      // skip a corrupt/partial line
    }
  }
  return samples;
}