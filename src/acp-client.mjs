import { spawn } from "node:child_process";
import readline from "node:readline";
import { DEFAULT_TIMEOUT_MS } from "./config.mjs";

/**
 * Grok ACP (Agent Client Protocol) 客户端，通过 stdio 与 Grok CLI 通信。
 *
 * 协议流程：
 * 1. spawn: grok --no-auto-update agent --always-approve --model <model> stdio
 * 2. initialize: 协商协议版本，clientCapabilities 必须为空（不声明 fs/terminal）
 * 3. authenticate: 优先用 xai.api_key（如果 XAI_API_KEY 环境变量存在），否则用 cached_token
 * 4. session/new: 创建新会话，传入 cwd
 * 5. session/prompt: 发送提示词，流式接收 session/update 通知
 * 6. waitForStableText: 轮询直到输出文本长度稳定
 *
 * @class
 * @example
 * const client = new GrokAcpClient({
 *   model: "grok-composer-2.5-fast",
 *   cwd: "/home/user/project",
 *   onChunk: (text) => console.log("Chunk:", text),
 *   onToolEvent: () => console.log("Tool called"),
 * });
 *
 * const result = await client.runPrompt("Hello");
 * console.log("Final reply:", result.text);
 */
export class GrokAcpClient {
  /**
   * 创建 GrokAcpClient 实例。
   *
   * @param {Object} [options={}] - 配置选项
   * @param {string} [options.grokBin="grok"] - Grok CLI 可执行文件路径
   * @param {string} [options.model="grok-composer-2.5-fast"] - Grok 模型名称
   * @param {string} [options.cwd] - 默认工作目录，传递给 session/new
   * @param {boolean} [options.noAutoUpdate=true] - 是否传递 --no-auto-update
   * @param {boolean} [options.alwaysApprove=true] - 是否传递 --always-approve
   * @param {boolean} [options.debug=false] - 是否传递 --debug 给 grok agent stdio
   * @param {string} [options.debugFile] - 传递 --debug-file 给 grok agent stdio
   * @param {string} [options.leaderSocket] - 传递 --leader-socket 给 grok agent stdio
   * @param {Function} [options.onChunk] - 流式输出回调，每次收到 agent_message_chunk 时触发，参数为增量文本
   * @param {Function} [options.onToolEvent] - 工具调用回调，收到 tool_call/tool_call_update 时触发
   * @param {Function} [options.onSession] - 会话创建/加载回调，session/new 或 session/load 一拿到 id 就触发，
   *   参数为 sessionId。用于在 prompt 开始前就把 sessionId 广播出去，使后续超时可续跑。
   */
  constructor(options = {}) {
    this.grokBin = options.grokBin || "grok";
    this.model = options.model || "grok-composer-2.5-fast";
    this.cwd = options.cwd || process.cwd();
    this.noAutoUpdate = options.noAutoUpdate !== false;
    this.alwaysApprove = options.alwaysApprove !== false;
    this.debug = Boolean(options.debug);
    this.debugFile = options.debugFile;
    this.leaderSocket = options.leaderSocket;
    this.onChunk = typeof options.onChunk === "function" ? options.onChunk : null;
    this.onToolEvent = typeof options.onToolEvent === "function" ? options.onToolEvent : null;
    this.onSession = typeof options.onSession === "function" ? options.onSession : null;
    this.stderr = "";
    this.text = "";
    this.events = [];
    this.pending = new Map();
    this.nextId = 1;
    this.proc = null;
    this.rl = null;
    /** 当前会话 id；session 一创建/加载就写入，即使随后 prompt 超时也保留，供续跑用。 */
    this.sessionId = null;
  }

  resetStreamState() {
    this.stderr = "";
    this.text = "";
    this.events = [];
  }

  start() {
    if (this.proc) return;

    const args = [];
    if (this.noAutoUpdate) args.push("--no-auto-update");
    args.push("agent");
    if (this.alwaysApprove) args.push("--always-approve");
    if (this.model) args.push("--model", this.model);
    if (this.debug) args.push("--debug");
    if (this.debugFile) args.push("--debug-file", this.debugFile);
    if (this.leaderSocket) args.push("--leader-socket", this.leaderSocket);
    args.push("stdio");

    try {
      this.proc = spawn(this.grokBin, args, {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err) {
      throw new Error(
        `Failed to spawn grok agent stdio: ${err.message}\n` +
        `Binary: ${this.grokBin}\n` +
        `Model: ${this.model}\n` +
        `Hint: Run 'grok --version' to verify Grok CLI is installed and in PATH.`,
      );
    }

    this.proc.stderr.on("data", chunk => {
      this.stderr += chunk.toString();
    });

    this.proc.on("error", err => {
      const error = new Error(
        `Failed to spawn grok agent stdio: ${err.message}\n` +
        `Binary: ${this.grokBin}\n` +
        `Model: ${this.model}\n` +
        `Hint: Run 'grok --version' to verify Grok CLI is installed and in PATH.`,
      );
      for (const [id, pendingRequest] of this.pending) {
        clearTimeout(pendingRequest.timer);
        pendingRequest.reject(error);
        this.pending.delete(id);
      }
    });

    this.proc.on("exit", (code, signal) => {
      const error = new Error(
        `grok agent stdio exited unexpectedly\n` +
        `Exit code: ${code}, Signal: ${signal}\n` +
        `Model: ${this.model}\n` +
        `Binary: ${this.grokBin}\n` +
        `Hint: Check stderr for Grok CLI errors, or try --debug.`,
      );
      for (const [id, pendingRequest] of this.pending) {
        clearTimeout(pendingRequest.timer);
        pendingRequest.reject(error);
        this.pending.delete(id);
      }
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on("line", line => this.handleLine(line));
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      console.error(
        `grokACP: JSON parse failed: ${err.message}\n` +
        `Line (first 100 chars): ${line.slice(0, 100)}\n` +
        `Hint: Grok CLI may have printed non-JSON to stdout (debug mode enabled?).`,
      );
      this.events.push({ type: "non_json_stdout", line });
      return;
    }

    if (message.method === "session/update") {
      this.events.push(message);
      const update = message.params?.update;
      if (update?.sessionUpdate === "agent_message_chunk" && update.content?.text) {
        this.text += update.content.text;
        if (this.onChunk) {
          try {
            this.onChunk(update.content.text);
          } catch {
            // Monitoring is a side channel; a broken callback must never
            // disrupt ACP stream handling.
          }
        }
      }
      if (
        (update?.sessionUpdate === "tool_call" || update?.sessionUpdate === "tool_call_update") &&
        this.onToolEvent
      ) {
        try {
          // Pass the update type so the recorder can count distinct tool
          // *calls* (tool_call) without double-counting their tool_call_update
          // progress events.
          this.onToolEvent(update.sessionUpdate);
        } catch {
          // Monitoring is a side channel; a broken callback must never
          // disrupt ACP stream handling.
        }
      }
      return;
    }

    const pendingRequest = this.pending.get(message.id);
    if (!pendingRequest) {
      this.events.push({ type: "unmatched_message", message });
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pendingRequest.timer);
    if (message.error) {
      pendingRequest.reject(
        new Error(
          `JSON-RPC server error: ${message.error.message ?? JSON.stringify(message.error)}\n` +
          `Request ID: ${message.id}\n` +
          `Hint: Check Grok CLI logs (--debug-file) for protocol errors.`,
        ),
      );
    } else {
      pendingRequest.resolve(message.result ?? {});
    }
  }

  request(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.proc) this.start();
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const paramsPreview = JSON.stringify(params);
        reject(
          new Error(
            `JSON-RPC ${method} timed out after ${timeoutMs}ms\n` +
            `Params: ${paramsPreview.slice(0, 100)}${paramsPreview.length > 100 ? "..." : ""}\n` +
            (this.stderr ? `Stderr: ${this.stderr.slice(0, 200)}\n` : "") +
            `Hint: Try increasing --timeout-ms or check if Grok CLI is stuck.`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async initialize(timeoutMs) {
    return await this.request(
      "initialize",
      {
        protocolVersion: 1,
        // Do not advertise client-side fs/terminal capabilities unless this
        // wrapper implements those JSON-RPC callbacks. Grok CLI already has its
        // own approved tools under --always-approve; claiming unimplemented
        // client tools leaves Shell/Write calls pending until session/prompt
        // times out.
        clientCapabilities: {},
      },
      timeoutMs,
    );
  }

  async authenticate(initResult, timeoutMs) {
    const authMethods = new Set((initResult.authMethods ?? []).map(method => method.id));
    const methodId =
      process.env.XAI_API_KEY && authMethods.has("xai.api_key")
        ? "xai.api_key"
        : authMethods.has("cached_token")
          ? "cached_token"
          : null;

    if (!methodId) {
      const available = [...authMethods].join(", ") || "none";
      throw new Error(
        `Grok authenticate failed: no auth method available\n` +
        `Available methods: ${available}\n` +
        `XAI_API_KEY set: ${Boolean(process.env.XAI_API_KEY)}\n` +
        `Hint: Run 'grok login' first, or set XAI_API_KEY.`,
      );
    }

    const result = await this.request("authenticate", { methodId, _meta: { headless: true } }, timeoutMs);
    return { methodId, result };
  }

  async createSession(options = {}, timeoutMs) {
    return await this.request(
      "session/new",
      {
        cwd: options.cwd || this.cwd,
        mcpServers: options.mcpServers || [],
      },
      timeoutMs,
    );
  }

  async loadSession(sessionId, options = {}, timeoutMs) {
    return await this.request(
      "session/load",
      {
        sessionId,
        cwd: options.cwd || this.cwd,
        mcpServers: options.mcpServers || [],
      },
      timeoutMs,
    );
  }

  async prompt(sessionId, text, timeoutMs) {
    return await this.request(
      "session/prompt",
      {
        sessionId,
        prompt: [{ type: "text", text }],
      },
      timeoutMs,
    );
  }

  /**
   * 记录并广播会话 id —— 在 session 创建/加载后、prompt 发送前立即调用。
   * 即使随后 prompt 超时，this.sessionId 仍保留，且 onSession 已把 id 送出，PM 可续跑。
   */
  rememberSession(sessionId) {
    this.sessionId = sessionId;
    if (this.onSession) {
      try {
        this.onSession(sessionId);
      } catch {
        // 广播回调绝不能中断真正的运行
      }
    }
  }

  async waitForStableText(options = {}) {
    const intervalMs = options.intervalMs ?? 150;
    const stableChecksRequired = options.stableChecks ?? 2;
    const maxWaitMs = options.maxWaitMs ?? 10000;
    const startedAt = Date.now();
    let lastLength = -1;
    let stableChecks = 0;

    while (stableChecks < stableChecksRequired) {
      await sleep(intervalMs);
      if (this.text.length === lastLength) {
        stableChecks += 1;
      } else {
        lastLength = this.text.length;
        stableChecks = 0;
      }

      if (Date.now() - startedAt > maxWaitMs) break;
    }
  }

  /**
   * 发送提示词并等待回复。
   *
   * @param {string} promptText - 提示词文本
   * @param {Object} [options={}] - 运行选项
   * @param {number} [options.timeoutMs] - JSON-RPC 请求超时（毫秒）；默认见 config DEFAULT_TIMEOUT_MS
   * @param {string} [options.sessionId] - 可选的已有会话 ID；传入时调用 session/load
   * @param {string} [options.cwd] - 会话工作目录
   * @param {Array} [options.mcpServers] - 传递给 session/new 或 session/load 的 MCP 服务器列表
   * @param {number} [options.stableIntervalMs] - waitForStableText 轮询间隔（毫秒）
   * @param {number} [options.stableChecks] - 判定文本稳定所需的连续相同长度次数
   * @param {number} [options.stableMaxWaitMs] - waitForStableText 最大等待时间（毫秒）
   * @returns {Promise<{
   *   init: Object,
   *   authMethod: string,
   *   sessionId: string,
   *   promptResult: Object,
   *   text: string,
   *   stderr: string,
   *   events: Array
   * }>} 返回包含最终回复文本和协议元数据的对象
   * @throws {Error} 当 Grok CLI 进程退出、JSON-RPC 超时或协议错误时抛出
   *
   * @example
   * const result = await client.runPrompt("用一句话介绍 Node.js");
   * console.log(result.text);
   */
  async runPrompt(promptText, options = {}) {
    this.resetStreamState();
    this.start();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const init = await this.initialize(timeoutMs);
    const auth = await this.authenticate(init, timeoutMs);
    let sessionId;
    if (options.sessionId) {
      await this.loadSession(options.sessionId, { cwd: options.cwd || this.cwd, mcpServers: options.mcpServers }, timeoutMs);
      sessionId = options.sessionId;
    } else {
      const created = await this.createSession({ cwd: options.cwd || this.cwd, mcpServers: options.mcpServers }, timeoutMs);
      sessionId = created.sessionId;
    }
    this.rememberSession(sessionId);
    const promptResult = await this.prompt(sessionId, promptText, timeoutMs);
    await this.waitForStableText({
      intervalMs: options.stableIntervalMs,
      stableChecks: options.stableChecks,
      maxWaitMs: options.stableMaxWaitMs,
    });

    return {
      init,
      authMethod: auth.methodId,
      sessionId,
      promptResult,
      text: this.text.trim(),
      stderr: this.stderr.trim(),
      events: this.events,
    };
  }

  async newSession(options = {}) {
    this.resetStreamState();
    this.start();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const init = await this.initialize(timeoutMs);
    const auth = await this.authenticate(init, timeoutMs);
    const session = await this.createSession({ cwd: options.cwd || this.cwd, mcpServers: options.mcpServers }, timeoutMs);

    return {
      init,
      authMethod: auth.methodId,
      sessionId: session.sessionId,
      stderr: this.stderr.trim(),
      events: this.events,
    };
  }

  close() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
