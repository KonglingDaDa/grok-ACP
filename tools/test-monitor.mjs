#!/usr/bin/env node
// Integration test: fake tasks + monitor API/SSE/DELETE per docs/monitor-ui-design.md §3.7.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = `/tmp/grok-acp-test-${Date.now()}`;
const port = 41731 + Math.floor(Math.random() * 100);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.error(`ok: ${message}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.json();
  return { res, body };
}

async function waitForTasks(minCount, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { res, body } = await fetchJson(`http://127.0.0.1:${port}/api/tasks`);
    if (res.ok && Array.isArray(body.tasks) && body.tasks.length >= minCount) {
      return body.tasks;
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for >= ${minCount} tasks`);
}

async function waitForRunningTask(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { res, body } = await fetchJson(`http://127.0.0.1:${port}/api/tasks`);
    if (res.ok && Array.isArray(body.tasks)) {
      const running = body.tasks.find(t => t.effectiveStatus === "running" || t.status === "running");
      if (running) return running;
    }
    await sleep(200);
  }
  throw new Error("timed out waiting for a running task");
}

function assertListTasksOmitPrompt(tasks) {
  for (const task of tasks) {
    if (Object.prototype.hasOwnProperty.call(task, "prompt")) {
      throw new Error(`list task ${task.id} must not include prompt`);
    }
  }
}

function runNode(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`${script} exited ${code}: ${stderr}`));
    });
  });
}

function spawnBackground(script, args, env = {}) {
  return spawn(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
}

async function main() {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });

  ok(`home=${home} port=${port}`);

  await runNode(
    path.join(repoRoot, "tools/dev-fake-task.mjs"),
    ["--home", home, "--count", "2", "--duration-ms", "8000"],
    { GROK_ACP_HOME: home },
  );
  ok("seed done/error tasks");

  const serverProc = spawn(
    process.execPath,
    [path.join(repoRoot, "bin/grok-acp.mjs"), "ui", "--port", String(port), "--host", "127.0.0.1"],
    {
      cwd: repoRoot,
      env: { ...process.env, GROK_ACP_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const fakeProc = spawnBackground(
    path.join(repoRoot, "tools/dev-fake-task.mjs"),
    ["--home", home, "--only", "long", "--duration-ms", "120000"],
    { GROK_ACP_HOME: home },
  );

  let serverLog = "";
  serverProc.stderr.on("data", chunk => {
    serverLog += chunk.toString();
  });

  try {
    await sleep(400);

    const running = await waitForRunningTask();
    ok(`running task visible: ${running.id}`);

    const blocked = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${encodeURIComponent(running.id)}`, {
      method: "DELETE",
    });
    if (blocked.res.status !== 409) {
      throw new Error(`DELETE running task expected 409, got ${blocked.res.status}`);
    }
    ok("DELETE running task -> 409");

    const tasks = await waitForTasks(3);
    ok(`GET /api/tasks -> ${tasks.length} tasks`);
    assertListTasksOmitPrompt(tasks);
    ok("GET /api/tasks omits prompt field");

    const doneTask = tasks.find(t => t.status === "done" || t.effectiveStatus === "done");
    if (!doneTask) throw new Error("no done task found for detail/output/delete tests");

    const detail = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${encodeURIComponent(doneTask.id)}`);
    if (!detail.res.ok || !Array.isArray(detail.body.samples)) {
      throw new Error(`GET /api/tasks/:id failed: ${detail.res.status}`);
    }
    if (typeof detail.body.meta?.prompt !== "string" || !detail.body.meta.prompt) {
      throw new Error("GET /api/tasks/:id meta must include full prompt");
    }
    if (!detail.body.meta?.effectiveStatus) {
      throw new Error("GET /api/tasks/:id meta must include effectiveStatus");
    }
    ok(`GET /api/tasks/:id -> ${detail.body.samples.length} samples + prompt + effectiveStatus`);

    const output = await fetchJson(
      `http://127.0.0.1:${port}/api/tasks/${encodeURIComponent(doneTask.id)}/output?from=0`,
    );
    if (!output.res.ok || typeof output.body.text !== "string") {
      throw new Error(`GET /api/tasks/:id/output failed: ${output.res.status}`);
    }
    ok(`GET /api/tasks/:id/output -> next=${output.body.next}`);

    const deleted = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${encodeURIComponent(doneTask.id)}`, {
      method: "DELETE",
    });
    if (!deleted.res.ok || !deleted.body.ok) {
      throw new Error(`DELETE done task failed: ${deleted.res.status}`);
    }
    ok(`DELETE /api/tasks/:id -> ok (${doneTask.id})`);

    const afterDelete = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${encodeURIComponent(doneTask.id)}`);
    if (afterDelete.res.status !== 404) {
      throw new Error(`deleted task should 404, got ${afterDelete.res.status}`);
    }
    ok("GET deleted task -> 404");

    const sseEvents = await new Promise((resolve, reject) => {
      const events = [];
      const timer = setTimeout(() => {
        controller.abort();
        resolve(events);
      }, 2500);
      const controller = new AbortController();
      fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal })
        .then(async res => {
          if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (events.length < 2) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() || "";
            for (const chunk of chunks) {
              if (chunk.startsWith("event: hello")) events.push("hello");
              if (chunk.startsWith("event: task")) events.push("task");
              if (chunk.startsWith("event: sample")) events.push("sample");
            }
          }
          clearTimeout(timer);
          controller.abort();
          resolve(events);
        })
        .catch(err => {
          if (err.name === "AbortError") resolve(events);
          else reject(err);
        });
    });

    if (!sseEvents.includes("hello")) {
      throw new Error(`SSE missing hello event: ${JSON.stringify(sseEvents)}`);
    }
    ok(`SSE /api/events -> ${sseEvents.join(", ")}`);

    console.error("PASS: monitor integration");
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    if (serverLog) console.error(serverLog);
  } finally {
    fakeProc.kill();
    serverProc.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

main().catch(err => {
  fail(err instanceof Error ? err.stack || err.message : String(err));
});