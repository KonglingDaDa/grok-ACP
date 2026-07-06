import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGrokAcpHome, getRunsDir } from "./paths.mjs";
import { cleanupOldRuns } from "./task-recorder.mjs";
import { createTaskIndex } from "./monitor-task-index.mjs";
import { createMonitorRouter } from "./monitor-routes.mjs";

const RUNNING_REFRESH_MS = 2000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const SSE_PING_MS = 15000;
const MAX_AGE_DAYS = 7;

function safeCall(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function startMonitorServer({ port = 41730, host = "127.0.0.1" } = {}) {
  const home = getGrokAcpHome();
  const runsDir = getRunsDir(home);
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.join(moduleDir, "..", "ui", "dist");

  const sseClients = new Set();

  function broadcastSse(event, data) {
    if (sseClients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  const index = createTaskIndex(runsDir, {
    onTask: task => broadcastSse("task", task),
    onSample: sample => broadcastSse("sample", sample),
  });

  function handleSse(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ now: Date.now(), runsDir })}\n\n`);
    sseClients.add(res);

    const pingTimer = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(pingTimer);
        sseClients.delete(res);
      }
    }, SSE_PING_MS);

    req.on("close", () => {
      clearInterval(pingTimer);
      sseClients.delete(res);
    });
  }

  const handleRequest = createMonitorRouter({
    host,
    port,
    runsDir,
    distDir,
    tasksById: index.tasksById,
    removeTaskRecord: index.removeTaskRecord,
    broadcastSse,
    handleSse,
  });

  const startupRemoved = safeCall(() => cleanupOldRuns(runsDir, MAX_AGE_DAYS)) ?? [];
  for (const id of startupRemoved) {
    index.removeTaskRecord(id);
    broadcastSse("deleted", { id });
  }
  safeCall(() => fs.mkdirSync(runsDir, { recursive: true }));
  index.fullRescan({ broadcast: false });

  let runsDirWatcher = null;
  try {
    runsDirWatcher = fs.watch(runsDir, () => index.scheduleTopLevelRescan());
  } catch (err) {
    console.error(`grokACP monitor: failed to watch ${runsDir}: ${err.message}`);
  }

  const runningRefreshTimer = setInterval(() => index.refreshRunningTasks(), RUNNING_REFRESH_MS);
  if (typeof runningRefreshTimer.unref === "function") runningRefreshTimer.unref();

  const cleanupTimer = setInterval(() => {
    const removed = safeCall(() => cleanupOldRuns(runsDir, MAX_AGE_DAYS)) ?? [];
    for (const id of removed) {
      index.removeTaskRecord(id);
      broadcastSse("deleted", { id });
    }
  }, CLEANUP_INTERVAL_MS);
  if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (err) {
      try {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("internal error");
      } catch {
        // response already sent/broken; nothing more to do
      }
      console.error(`grokACP monitor: request handler failed: ${err.message}`);
    }
  });

  server.on("close", () => {
    if (runsDirWatcher) {
      try {
        runsDirWatcher.close();
      } catch {
        // ignore
      }
    }
    clearInterval(runningRefreshTimer);
    clearInterval(cleanupTimer);
    index.closeAllWatchers();
  });

  return new Promise((resolve, reject) => {
    let started = false;
    server.on("error", err => {
      if (!started) {
        reject(err);
      } else {
        console.error(`grokACP monitor: server error: ${err.message}`);
      }
    });
    server.listen(port, host, () => {
      started = true;
      console.error(`grokACP monitor listening on http://${host}:${port}`);
      console.error(`grokACP monitor runsDir=${runsDir}`);
      resolve(server);
    });
  });
}