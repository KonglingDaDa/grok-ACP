import fs from "node:fs";
import path from "node:path";
import { computeEffectiveStatus, taskForList } from "./monitor-task-index.mjs";
import { parseThroughputNdjson } from "./monitor-throughput.mjs";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const TASK_ID_PATTERN = /^[0-9+\-a-f]+$/i;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readSamples(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, "throughput.ndjson"), "utf8");
    return parseThroughputNdjson(raw);
  } catch {
    return [];
  }
}

function readOutput(dir) {
  try {
    return fs.readFileSync(path.join(dir, "output.md"), "utf8");
  } catch {
    return "";
  }
}

export function createMonitorRouter({
  host,
  port,
  runsDir,
  distDir,
  tasksById,
  removeTaskRecord,
  broadcastSse,
  handleSse,
}) {
  function resolveTaskId(rawSegment) {
    let id;
    try {
      id = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }
    if (!TASK_ID_PATTERN.test(id)) return null;
    if (id.includes("/") || id.includes("\\") || id.includes("..")) return null;
    const dir = path.resolve(runsDir, id);
    if (path.dirname(dir) !== runsDir) return null;
    return id;
  }

  function serveStatic(_req, res, pathname) {
    if (!fs.existsSync(distDir)) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("grokACP monitor UI is not built yet.\n\nRun: npm run ui:build\n");
      return;
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      decodedPath = "/index.html";
    }

    let filePath = path.join(distDir, decodedPath);
    if (filePath !== distDir && !filePath.startsWith(distDir + path.sep)) {
      filePath = path.join(distDir, "index.html");
    }

    fs.stat(filePath, (err, stat) => {
      const finalPath = !err && stat.isFile() ? filePath : path.join(distDir, "index.html");
      fs.readFile(finalPath, (readErr, data) => {
        if (readErr) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("not found");
          return;
        }
        const ext = path.extname(finalPath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
  }

  return function handleRequest(req, res) {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("bad request");
      return;
    }
    const pathname = url.pathname;

    if (pathname === "/api/tasks" && req.method === "GET") {
      const tasks = Array.from(tasksById.values(), record =>
        taskForList(record.meta, record.effectiveStatus),
      );
      sendJson(res, 200, { tasks });
      return;
    }

    const outputMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/output$/);
    if (outputMatch && req.method === "GET") {
      const taskId = resolveTaskId(outputMatch[1]);
      const record = taskId ? tasksById.get(taskId) : null;
      if (!taskId) {
        sendJson(res, 400, { error: "invalid task id" });
        return;
      }
      if (!record) {
        sendJson(res, 404, { error: "task not found" });
        return;
      }
      const fromRaw = Number(url.searchParams.get("from"));
      const from = Number.isFinite(fromRaw) && fromRaw >= 0 ? fromRaw : 0;
      const text = readOutput(record.dir);
      const slice = from < text.length ? text.slice(from) : "";
      sendJson(res, 200, {
        text: slice,
        next: text.length,
        done: computeEffectiveStatus(record.meta) !== "running",
      });
      return;
    }

    const detailMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (detailMatch) {
      const taskId = resolveTaskId(detailMatch[1]);
      if (!taskId) {
        sendJson(res, 400, { error: "invalid task id" });
        return;
      }
      const record = tasksById.get(taskId);
      if (!record) {
        sendJson(res, 404, { error: "task not found" });
        return;
      }

      if (req.method === "GET") {
        sendJson(res, 200, {
          meta: { ...record.meta, effectiveStatus: record.effectiveStatus },
          samples: readSamples(record.dir),
        });
        return;
      }

      if (req.method === "DELETE") {
        if (computeEffectiveStatus(record.meta) === "running") {
          sendJson(res, 409, { error: "task is running" });
          return;
        }
        try {
          fs.rmSync(record.dir, { recursive: true, force: true });
        } catch (err) {
          sendJson(res, 500, { error: err?.message || "failed to delete task" });
          return;
        }
        removeTaskRecord(taskId);
        broadcastSse("deleted", { id: taskId });
        sendJson(res, 200, { ok: true, id: taskId });
        return;
      }

      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    if (pathname === "/api/events" && req.method === "GET") {
      handleSse(req, res);
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    serveStatic(req, res, pathname);
  };
}