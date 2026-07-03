import { spawn } from "node:child_process";
import readline from "node:readline";

export class GrokAcpClient {
  constructor(options = {}) {
    this.grokBin = options.grokBin || "grok";
    this.model = options.model || "grok-composer-2.5-fast";
    this.cwd = options.cwd || process.cwd();
    this.noAutoUpdate = options.noAutoUpdate !== false;
    this.alwaysApprove = options.alwaysApprove !== false;
    this.debug = Boolean(options.debug);
    this.debugFile = options.debugFile;
    this.leaderSocket = options.leaderSocket;
    this.stderr = "";
    this.text = "";
    this.events = [];
    this.pending = new Map();
    this.nextId = 1;
    this.proc = null;
    this.rl = null;
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

    this.proc = spawn(this.grokBin, args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.proc.stderr.on("data", chunk => {
      this.stderr += chunk.toString();
    });

    this.proc.on("exit", (code, signal) => {
      const error = new Error(`grok agent stdio exited code=${code} signal=${signal}`);
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
    } catch {
      this.events.push({ type: "non_json_stdout", line });
      return;
    }

    if (message.method === "session/update") {
      this.events.push(message);
      const update = message.params?.update;
      if (update?.sessionUpdate === "agent_message_chunk" && update.content?.text) {
        this.text += update.content.text;
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
      pendingRequest.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    } else {
      pendingRequest.resolve(message.result ?? {});
    }
  }

  request(method, params = {}, timeoutMs = 30000) {
    if (!this.proc) this.start();
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms${this.stderr ? `; stderr=${this.stderr}` : ""}`));
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
      throw new Error("No Grok auth method is available. Run `grok login` first, or set XAI_API_KEY.");
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

  async runPrompt(promptText, options = {}) {
    this.start();
    const timeoutMs = options.timeoutMs ?? 120000;
    const init = await this.initialize(timeoutMs);
    const auth = await this.authenticate(init, timeoutMs);
    const sessionId = options.sessionId
      ? (await this.loadSession(options.sessionId, { cwd: options.cwd || this.cwd, mcpServers: options.mcpServers }, timeoutMs), options.sessionId)
      : (await this.createSession({ cwd: options.cwd || this.cwd, mcpServers: options.mcpServers }, timeoutMs)).sessionId;
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
    this.start();
    const timeoutMs = options.timeoutMs ?? 120000;
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
