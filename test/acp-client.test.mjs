import { describe, it } from "node:test";
import assert from "node:assert";
import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { GrokAcpClient } from "../src/acp-client.mjs";

/**
 * 创建一个 fake ChildProcess，用于模拟 grok agent stdio 子进程。
 *
 * @param {Function} onRequest - 收到 JSON-RPC 请求时的回调
 * @returns {Object} fake ChildProcess 实例，包含 stdin/stdout/stderr 流和事件
 */
function createFakeProcess(onRequest) {
  const proc = new EventEmitter();

  proc.stdin = new Writable({
    write(chunk, encoding, callback) {
      const line = chunk.toString().trim();
      if (line) {
        try {
          onRequest(JSON.parse(line), (responseLine) => {
            proc._deliverLine(responseLine);
          });
        } catch {
          // 与 handleLine 一致：非 JSON 写入不崩溃测试进程
        }
      }
      callback();
    },
  });

  proc.stdout = new Readable({
    read() {},
  });

  proc.stderr = new Readable({
    read() {},
  });

  proc._deliverLine = null;

  proc.kill = () => {};

  proc._exit = (code, signal = null) => {
    proc.emit("exit", code, signal);
    proc.stdout.push(null);
    proc.stderr.push(null);
  };

  return proc;
}

/**
 * 将 fake process 挂到 GrokAcpClient，复用 start() 中的 stderr/exit 逻辑。
 *
 * @param {GrokAcpClient} client
 * @param {ReturnType<createFakeProcess>} proc
 */
function attachFakeProcess(client, proc) {
  client.proc = proc;

  proc.stderr.on("data", (chunk) => {
    client.stderr += chunk.toString();
  });

  proc.on("exit", (code, signal) => {
    const error = new Error(`grok agent stdio exited code=${code} signal=${signal}`);
    for (const [id, pendingRequest] of client.pending) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(error);
      client.pending.delete(id);
    }
  });

  proc._deliverLine = (line) => {
    client.handleLine(line);
  };
}

function createHappyPathResponder({ toolCall = false, replyText = "Hello from Grok" } = {}) {
  let promptSeen = false;

  return (request, send) => {
    if (request.method === "initialize") {
      send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: 1,
            serverInfo: { name: "grok" },
            authMethods: [{ id: "cached_token" }],
          },
        }),
      );
      return;
    }

    if (request.method === "authenticate" || request.method === "session/new" || request.method === "session/prompt") {
      if (request.method === "session/new") {
        send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { sessionId: "test-session-123" } }));
        return;
      }

      send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }));

      if (request.method === "session/prompt" && !promptSeen) {
        promptSeen = true;

        if (toolCall) {
          send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                update: {
                  sessionUpdate: "tool_call",
                  tool: "Shell",
                  input: { command: "ls" },
                },
              },
            }),
          );
        }

        send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { text: replyText },
              },
            },
          }),
        );

        send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { text: "", done: true },
              },
            },
          }),
        );
      }
    }
  };
}

describe("GrokAcpClient", () => {
  it("should complete full happy path: initialize → authenticate → session/new → prompt", async () => {
    const proc = createFakeProcess(createHappyPathResponder());
    const chunks = [];
    const client = new GrokAcpClient({
      model: "grok-composer-2.5-fast",
      cwd: "/tmp",
      onChunk: (text) => chunks.push(text),
    });

    attachFakeProcess(client, proc);

    const result = await client.runPrompt("Test prompt", { stableIntervalMs: 50, stableChecks: 2 });

    assert.strictEqual(result.text, "Hello from Grok");
    assert.deepStrictEqual(chunks, ["Hello from Grok"]);
    assert.strictEqual(result.sessionId, "test-session-123");
    client.close();
  });

  it("should trigger onToolEvent callback on tool_call", async () => {
    const proc = createFakeProcess(createHappyPathResponder({ toolCall: true, replyText: "Done" }));
    let toolEventTriggered = false;
    const client = new GrokAcpClient({
      model: "grok-composer-2.5-fast",
      cwd: "/tmp",
      onChunk: () => {},
      onToolEvent: () => {
        toolEventTriggered = true;
      },
    });

    attachFakeProcess(client, proc);

    await client.runPrompt("Test", { stableIntervalMs: 50, stableChecks: 2 });

    assert.strictEqual(toolEventTriggered, true, "onToolEvent should be triggered");
    client.close();
  });

  it("should handle process exit before initialize", async () => {
    const proc = createFakeProcess(() => {});
    const client = new GrokAcpClient({
      model: "grok-composer-2.5-fast",
      cwd: "/tmp",
      onChunk: () => {},
    });

    attachFakeProcess(client, proc);
    setImmediate(() => proc._exit(1));

    await assert.rejects(
      async () => await client.runPrompt("Test", { timeoutMs: 5000 }),
      /grok agent stdio exited/i,
      "Should throw error when process exits early",
    );
    client.close();
  });

  it("should tolerate omitted onChunk and onToolEvent callbacks", async () => {
    const proc = createFakeProcess(createHappyPathResponder());
    const client = new GrokAcpClient({
      model: "grok-composer-2.5-fast",
      cwd: "/tmp",
    });

    attachFakeProcess(client, proc);

    const result = await client.runPrompt("Test", { stableIntervalMs: 50, stableChecks: 2 });

    assert.strictEqual(result.text, "Hello from Grok");
    client.close();
  });

  it("should clear accumulated stream state before each runPrompt", () => {
    const client = new GrokAcpClient({ model: "grok-composer-2.5-fast", cwd: "/tmp" });
    client.text = "previous reply";
    client.stderr = "previous stderr";
    client.events.push({ type: "old" });

    client.resetStreamState();

    assert.strictEqual(client.text, "");
    assert.strictEqual(client.stderr, "");
    assert.deepStrictEqual(client.events, []);
  });

  it("should handle JSON-RPC timeout", async () => {
    const proc = createFakeProcess(() => {
      // 不发送任何响应，模拟超时
    });
    const client = new GrokAcpClient({
      model: "grok-composer-2.5-fast",
      cwd: "/tmp",
      onChunk: () => {},
    });

    attachFakeProcess(client, proc);

    await assert.rejects(
      async () => await client.runPrompt("Test", { timeoutMs: 100 }),
      /timeout|timed out/i,
      "Should throw timeout error",
    );
    client.close();
  });

  it("should broadcast sessionId via onSession the moment the session is created", async () => {
    const proc = createFakeProcess(createHappyPathResponder());
    const seen = [];
    const client = new GrokAcpClient({
      model: "grok-composer-2.5-fast",
      cwd: "/tmp",
      onSession: (id) => seen.push(id),
    });

    attachFakeProcess(client, proc);

    const result = await client.runPrompt("Test", { stableIntervalMs: 50, stableChecks: 2 });

    assert.deepStrictEqual(seen, ["test-session-123"], "onSession should fire once with the created id");
    assert.strictEqual(client.sessionId, "test-session-123", "client.sessionId should be recorded");
    assert.strictEqual(result.sessionId, "test-session-123");
    client.close();
  });

  it("should retain sessionId even when session/prompt times out", async () => {
    // 回应 initialize/authenticate/session/new，但不回应 session/prompt —— 模拟
    // Grok 已在活跃 session 里干活、但 prompt 阶段超时的场景。
    const proc = createFakeProcess((request, send) => {
      if (request.method === "initialize") {
        send(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { protocolVersion: 1, serverInfo: { name: "grok" }, authMethods: [{ id: "cached_token" }] },
        }));
        return;
      }
      if (request.method === "authenticate") {
        send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }));
        return;
      }
      if (request.method === "session/new") {
        send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { sessionId: "test-session-123" } }));
        return;
      }
      // session/prompt: 故意不回应，触发超时
    });
    const seen = [];
    const client = new GrokAcpClient({
      model: "grok-composer-2.5-fast",
      cwd: "/tmp",
      onSession: (id) => seen.push(id),
    });

    attachFakeProcess(client, proc);

    await assert.rejects(
      async () => await client.runPrompt("Test", { timeoutMs: 100 }),
      /timed out/i,
      "session/prompt should time out",
    );

    assert.deepStrictEqual(seen, ["test-session-123"], "onSession fires before the prompt times out");
    assert.strictEqual(client.sessionId, "test-session-123", "sessionId survives the timeout for resume");
    client.close();
  });
});