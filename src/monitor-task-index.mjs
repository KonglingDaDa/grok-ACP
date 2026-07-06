import fs from "node:fs";
import path from "node:path";
import { parseThroughputNdjson } from "./monitor-throughput.mjs";

export const HEARTBEAT_STALE_MS = 8000;

const TASK_DIR_DEBOUNCE_MS = 50;
const TOP_LEVEL_DEBOUNCE_MS = 150;

const META_BROADCAST_FIELDS = [
  "status",
  "heartbeatAt",
  "tokensOut",
  "chars",
  "endedAt",
  "error",
  "sessionId",
  "reportPath",
  "jsonPath",
  "durationMs",
  "context",
];

/** List/SSE payload — omits full prompt; detail GET returns complete meta (§3.4). */
export function taskForList(meta, effectiveStatus) {
  const { prompt: _prompt, ...rest } = meta;
  return { ...rest, effectiveStatus };
}

export function computeEffectiveStatus(meta) {
  if (meta.status !== "running") return meta.status;

  let pidAlive = true;
  if (typeof meta.pid === "number") {
    try {
      process.kill(meta.pid, 0);
    } catch {
      pidAlive = false;
    }
  }

  const heartbeatMs = meta.heartbeatAt ? Date.parse(meta.heartbeatAt) : NaN;
  const stale = !Number.isFinite(heartbeatMs) || Date.now() - heartbeatMs > HEARTBEAT_STALE_MS;

  return !pidAlive || stale ? "interrupted" : "running";
}

function metaBroadcastSignature(meta) {
  return META_BROADCAST_FIELDS.map(key => JSON.stringify(meta[key] ?? null)).join("\x1e");
}

function metaBroadcastChanged(prev, next) {
  if (!prev) return true;
  return metaBroadcastSignature(prev) !== metaBroadcastSignature(next);
}

function initialThroughputOffset(dir) {
  try {
    return fs.readFileSync(path.join(dir, "throughput.ndjson"), "utf8").length;
  } catch {
    return 0;
  }
}

/**
 * In-memory task index with fs.watch-driven updates.
 * onTask({ meta, effectiveStatus }) and onSample({ id, t, tps, cum }) fire when broadcast:true.
 */
export function createTaskIndex(runsDir, { onTask, onSample }) {
  const tasksById = new Map();
  const pendingTaskDirEvents = new Map();
  let topLevelDebounceTimer = null;

  function loadMetaFromDisk(taskId) {
    const dir = path.join(runsDir, taskId);
    const metaFile = path.join(dir, "meta.json");
    try {
      const raw = fs.readFileSync(metaFile, "utf8");
      return { dir, meta: JSON.parse(raw) };
    } catch (err) {
      if (err && err.code !== "ENOENT") {
        console.error(`grokACP monitor: skipping corrupt meta.json for ${taskId}: ${err.message}`);
      }
      return null;
    }
  }

  function manageWatcher(taskId, record) {
    const shouldWatch = record.meta.status === "running";
    if (shouldWatch && !record.watcher) {
      try {
        record.watcher = fs.watch(record.dir, () => {
          scheduleTaskDirEvent(taskId);
        });
      } catch (err) {
        console.error(`grokACP monitor: failed to watch ${record.dir}: ${err.message}`);
      }
    } else if (!shouldWatch && record.watcher) {
      try {
        record.watcher.close();
      } catch {
        // ignore
      }
      record.watcher = null;
    }
  }

  function emitNewSamples(taskId, record) {
    if (!record) return;
    let raw;
    try {
      raw = fs.readFileSync(path.join(record.dir, "throughput.ndjson"), "utf8");
    } catch {
      return;
    }

    const prevLen = record.throughputOffset || 0;
    if (raw.length <= prevLen) {
      record.throughputOffset = raw.length;
      return;
    }

    record.throughputOffset = raw.length;

    for (const [t, tps, cum] of parseThroughputNdjson(raw, { fromOffset: prevLen })) {
      onSample({ id: taskId, t, tps, cum });
    }
  }

  function upsertTask(taskId, { broadcast }) {
    const loaded = loadMetaFromDisk(taskId);
    if (!loaded) return null;

    const effectiveStatus = computeEffectiveStatus(loaded.meta);
    const existing = tasksById.get(taskId);
    const changed =
      !existing ||
      existing.effectiveStatus !== effectiveStatus ||
      metaBroadcastChanged(existing.meta, loaded.meta);

    const record = existing || {
      dir: loaded.dir,
      throughputOffset: broadcast ? 0 : initialThroughputOffset(loaded.dir),
      watcher: null,
    };
    record.dir = loaded.dir;
    record.meta = loaded.meta;
    record.effectiveStatus = effectiveStatus;
    tasksById.set(taskId, record);

    manageWatcher(taskId, record);

    if (broadcast && changed) {
      onTask(taskForList(record.meta, record.effectiveStatus));
    }
    return record;
  }

  function scheduleTaskDirEvent(taskId) {
    if (pendingTaskDirEvents.has(taskId)) return;
    const timer = setTimeout(() => {
      pendingTaskDirEvents.delete(taskId);
      const record = upsertTask(taskId, { broadcast: true });
      emitNewSamples(taskId, record);
    }, TASK_DIR_DEBOUNCE_MS);
    if (typeof timer.unref === "function") timer.unref();
    pendingTaskDirEvents.set(taskId, timer);
  }

  function listRunDirs() {
    try {
      return fs
        .readdirSync(runsDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } catch {
      return [];
    }
  }

  function rescanTopLevel() {
    const entries = new Set(listRunDirs());
    for (const taskId of entries) {
      if (!tasksById.has(taskId)) {
        upsertTask(taskId, { broadcast: true });
      }
    }
  }

  function scheduleTopLevelRescan() {
    if (topLevelDebounceTimer) return;
    topLevelDebounceTimer = setTimeout(() => {
      topLevelDebounceTimer = null;
      rescanTopLevel();
    }, TOP_LEVEL_DEBOUNCE_MS);
    if (typeof topLevelDebounceTimer.unref === "function") topLevelDebounceTimer.unref();
  }

  function fullRescan({ broadcast }) {
    const entries = new Set(listRunDirs());
    for (const [taskId, record] of tasksById) {
      if (!entries.has(taskId)) {
        if (record.watcher) {
          try {
            record.watcher.close();
          } catch {
            // ignore
          }
        }
        tasksById.delete(taskId);
      }
    }
    for (const taskId of entries) {
      upsertTask(taskId, { broadcast });
    }
  }

  function recheckInterrupted() {
    for (const record of tasksById.values()) {
      if (record.meta.status !== "running") continue;
      const effectiveStatus = computeEffectiveStatus(record.meta);
      if (effectiveStatus !== record.effectiveStatus) {
        record.effectiveStatus = effectiveStatus;
        onTask(taskForList(record.meta, record.effectiveStatus));
      }
    }
  }

  function removeTaskRecord(taskId) {
    const record = tasksById.get(taskId);
    if (!record) return null;
    if (record.watcher) {
      try {
        record.watcher.close();
      } catch {
        // ignore
      }
      record.watcher = null;
    }
    tasksById.delete(taskId);
    return record;
  }

  function closeAllWatchers() {
    for (const record of tasksById.values()) {
      if (record.watcher) {
        try {
          record.watcher.close();
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    tasksById,
    upsertTask,
    fullRescan,
    scheduleTopLevelRescan,
    recheckInterrupted,
    removeTaskRecord,
    closeAllWatchers,
  };
}