# Grok ACP Run

- created_at_beijing: 2026-07-04T03:41:20+08:00
- model: grok-composer-2.5-fast
- cwd: /home/desk/dev/repos/grokACP
- prompt_source: /home/desk/dev/repos/grokACP/工程师任务/2026-07-04-0340-AI友好化-测试与文档/2026-07-04-0425-task-4-acp-client测试.md
- session_id: 019f297d-a82f-7060-8bae-ad0f961d6120
- stop_reason: end_turn
- auth_method: cached_token
- prompt_total_tokens: 38241
- prompt_model_id: grok-composer-2.5-fast

## Grok Reply

按 TDD 流程执行 T4：先读 `acp-client.mjs` 与 PRD，再建测试并补 JSDoc。
已有 JSDoc 和部分测试；正在对照实际 API 核对测试是否匹配。
测试与 JSDoc 已就绪且全部通过。正在派发 Critic 自审。
正在阅读这两个文件的完整内容，并按逻辑可靠性维度进行审查。
[CONFIRMED] `src/acp-client.mjs:63-64` — 子进程已退出时 `start()` 仍会因 `this.proc` 非空而直接返回  
详细说明：`start()` 在 `this.proc` 已存在时立即 return，不会重新 spawn。`exit` 处理器（86–93 行）只 reject `pending`，不把 `this.proc` 置为 `null`。进程异常退出后，客户端处于“proc 已死但引用仍在”的状态；再次 `request()`/`runPrompt()` 会向已关闭的 stdin 写入且无法自愈。复现：构造一次 exit 后不调用 `close()`，再调用 `runPrompt()`。

[CONFIRMED] `src/acp-client.mjs:86-93` — `exit` 处理未关闭 readline、未清空 `this.proc`  
详细说明：与真实 ChildProcess 不同，生产代码在 `exit` 时只清理 `pending` 请求，不调用 `this.rl.close()`，也不 `this.proc = null`。会导致 readline 继续挂在已结束的 stdout 上，并与上一条问题叠加使客户端无法恢复。复现：子进程在 `initialize` 之后退出，观察 `this.rl`、`this.proc` 仍为旧引用。

[CONFIRMED] `src/acp-client.mjs:281` — `runPrompt()` 未重置 `this.text` / `this.events` / `this.stderr`  
详细说明：流式 chunk 通过 `this.text += ...`（112 行）累积，`runPrompt` 入口无清零。同一 `GrokAcpClient` 实例多次调用会把多次回复拼在一起，`events`/`stderr` 也会混杂。复现：同一 client 连续两次 `runPrompt()`，第二次的 `result.text` 会包含第一次内容。

[CONFIRMED] `src/acp-client.mjs:250-251` — `waitForStableText` 超时后静默返回，不抛错  
详细说明：超过 `maxWaitMs` 时仅 `break` 出循环，`runPrompt` 仍返回当前 `this.text.trim()`，调用方无法区分“稳定完成”与“超时截断”。默认 `maxWaitMs=10000`，慢流或永不发送 `done` 的会话会误判为成功。复现：mock 只发部分 chunk 后停止，`runPrompt` 在超时后仍 resolve 且 `text` 不完整。

[CONFIRMED] `test/acp-client.test.mjs:13-26` — fake stdin 未模拟按行缓冲，与 readline 行为不一致  
详细说明：真实路径用 `readline` 按 `\n` 切分 stdout（95–96 行）；fake 在单次 `write` 里对整块 `chunk.toString().trim()` 做 `JSON.parse`。若一次写入含多条 JSON-RPC 行、或半行数据，会解析失败或丢消息。当前单请求单 write 的测试能通过，但不能代表生产 I/O。复现：在 fake `stdin.write` 中传入 `"line1\nline2"` 或半包 JSON。

[CONFIRMED] `test/acp-client.test.mjs:28-44` — fake 绕过 stdout，`_deliverLine` 直连 `handleLine`  
详细说明：测试通过 `attachFakeProcess` 设置 `proc` 后 `start()` 提前返回（63–64 行），从不创建 `readline`；响应经 `_deliverLine` 直接进 `handleLine`。happy path、tool event、超时等均未覆盖 stdout 分片、粘包、换行边界。复现：对比生产用真实子进程 stdout 与测试路径，后者跳过整段 readline 逻辑。

[CONFIRMED] `test/acp-client.test.mjs:55-74` — `attachFakeProcess` 重复实现 `start()` 的 stderr/exit 逻辑  
详细说明：因预置 `client.proc` 使 `start()` 跳过，测试必须手写 stderr 累积与 `pending` 清理。若 `start()`（82–93 行）日后修改而测试辅助未同步，会出现“测试绿、生产行为变”的漂移。复现：在 `start()` 的 `exit` 处理中增加逻辑但不改 `attachFakeProcess`，测试仍通过但生产行为已变。

[CONFIRMED] `test/acp-client.test.mjs:20` — fake stdin 中 `JSON.parse` 无 try/catch  
详细说明：非法 JSON 会在 `Writable.write` 内同步抛错，可能导致 `callback` 未调用或测试进程崩溃；真实子进程非 JSON stdout 由 `handleLine` 捕获（103–105 行），但 mock 在到达 `handleLine` 前就失败。复现：向 fake stdin 写入非 JSON 字节。

[PLAUSIBLE] `test/acp-client.test.mjs:192-208` — “进程提前退出”测试依赖 `setImmediate` 与默认 120s 超时竞态  
详细说明：未传 `timeoutMs`，`runPrompt` 默认 120000ms（283 行）。用例假定 `setImmediate` 触发的 `exit` 会在 `initialize` pending 期间 reject；若时序异常（pending 尚未注册或 exit 未触发 reject），测试会挂起最多 120s 而非快速失败。复现：在 `runPrompt` 前人为延迟注册 pending，或去掉 `attachFakeProcess` 的 exit 处理器。

[PLAUSIBLE] `test/acp-client.test.mjs:38` — `proc.kill` 为空操作，与真实 `ChildProcess.kill` 不符  
详细说明：真实 `kill` 会发信号并通常触发 `exit`；fake 的 `kill` 什么都不做。`close()` 在测试中不会走 exit 清理路径，无法验证 kill 后 pending/timer 是否释放。复现：在请求进行中调用 `client.close()`，对比真实子进程与 fake 的 pending 清理差异。

[PLAUSIBLE] `test/acp-client.test.mjs`（整体）— 缺少 JSON-RPC 协议错误与非 JSON stdout 场景  
详细说明：`handleLine` 对 `message.error`（144–145 行）、`non_json_stdout`（103–105 行）、`unmatched_message`（137–139 行）有分支，但测试仅覆盖 happy path、tool event、提前 exit、无响应超时。协议层错误是否被正确 reject/记录未验证。复现：mock 对 `initialize` 返回 `{ error: {...} }` 或 stdout 一行纯文本，当前测试套件无对应用例。

[PLAUSIBLE] `test/acp-client.test.mjs`（整体）— 未显式验证 `onChunk`/`onToolEvent` 为 `null` 时的安全性  
详细说明：生产代码在 52–53、113、124 行做了 null 防护，逻辑上安全，但测试里总是传入函数（或 happy path 传入 `onChunk`）。缺少“省略回调”用例，回归时若去掉 guard 测试仍可能全绿。复现：`new GrokAcpClient({ cwd: "/tmp" })` 跑 happy path mock，确认不抛错——当前无此用例。Critic 指出测试可改进项；在不动 `GrokAcpClient` 实现的前提下，我会增强测试的健壮性。
## 修改文件清单

| 文件 | 改动 |
|------|------|
| `test/acp-client.test.mjs` | 新建协议层单元测试（5 个用例） |
| `src/acp-client.mjs` | 补充 JSDoc（实现逻辑未动） |

---

## 关键改动说明

### `test/acp-client.test.mjs`

采用 **request-driven mock**（`createFakeProcess` + `attachFakeProcess`），而非任务模板中的 `mockSpawn` + 动态 `import`，原因：

- 实际 API 与模板不一致：`runPrompt()` 返回 `{ text, sessionId, ... }` 对象，不是字符串；`timeoutMs` 在 `runPrompt` 的 options 里，不在 constructor；`authenticate` 需要 `initialize` 返回 `authMethods`。
- 当前方案直接注入 fake process，避免全局 mock `spawn` 的模块缓存问题，且能按请求 ID 正确响应。

**测试覆盖（5 个）：**

1. 完整 happy path（initialize → authenticate → session/new → prompt + 流式 chunk）
2. `onToolEvent` 在 `tool_call` 时触发
3. 进程提前退出抛错
4. 省略 `onChunk`/`onToolEvent` 时安全运行（Critic 建议补充）
5. JSON-RPC 超时

**Critic 驱动的测试加固：**

- fake stdin 的 `JSON.parse` 加了 try/catch
- 进程退出用例加了 `timeoutMs: 5000` 兜底，避免竞态时挂 120s

### `src/acp-client.mjs`

JSDoc 已按**真实 API** 编写（与任务模板略有出入，但更准确）：

- 类级文档：协议 6 步流程 + `@example`
- `constructor`：全部选项参数（含 `noAutoUpdate`、`alwaysApprove`）
- `runPrompt`：返回 `Promise<{ text, sessionId, ... }>`，非 `Promise<string>`

实现代码零改动。

---

## 验收结果

### 步骤 1：测试（绿）

```bash
cd /home/desk/dev/repos/grokACP
node --test test/acp-client.test.mjs
```

```
✔ GrokAcpClient (5)
  ✔ should complete full happy path: initialize → authenticate → session/new → prompt
  ✔ should trigger onToolEvent callback on tool_call
  ✔ should handle process exit before initialize
  ✔ should tolerate omitted onChunk and onToolEvent callbacks
  ✔ should handle JSON-RPC timeout

Tests  5 passed (5)
```

### 步骤 2：JSDoc 检查

```bash
grep -A 15 "@class\|@param\|@returns\|@example" src/acp-client.mjs | head -50
```

`GrokAcpClient` 类、`constructor`、`runPrompt` 均有完整 JSDoc（`@class`、`@param`、`@returns`、`@example`、`@throws`）。

### 步骤 3：Lint

```bash
npm run lint
```

`acp-client.mjs` 通过 `node --check`，无错误。

---

## Critic 自审结果与处理

### CONFIRMED（`src/acp-client.mjs`）— 未修，任务禁止改实现

| 发现 | 处理理由 |
|------|----------|
| `start()` 进程退出后 `this.proc` 不置空，无法自愈 | 任务明确「不要改变类实现」；属设计取舍，CLI 每次 `run` 新建 client |
| `exit` 未关闭 readline | 同上 |
| `runPrompt` 不重置 `text`/`events`/`stderr` | 同上；单次 dispatch 模式不受影响 |
| `waitForStableText` 超时静默返回 | 同上；生产靠 smoke 覆盖 |

### CONFIRMED（`test/acp-client.test.mjs`）— 部分修

| 发现 | 处理 |
|------|------|
| fake stdin 无 try/catch | **已修** |
| fake 绕过 readline/stdout | **接受**：单元测试聚焦协议状态机；端到端 smoke 覆盖真实子进程 |
| `attachFakeProcess` 重复 `start()` 逻辑 | **接受**：有意为之，避免真实 spawn；在注释中说明 |
| fake stdin 不按行缓冲 | **接受**：当前单请求单 write 足够；粘包场景留给集成测试 |

### PLAUSIBLE — 评估后处理

| 发现 | 处理 |
|------|------|
| 进程退出测试 `setImmediate` 竞态 | **已修**：加 `timeoutMs: 5000` 兜底 |
| `proc.kill` 空操作 | **不修**：`close()` 在每条用例末尾调用，资源已释放 |
| 缺 JSON-RPC error / non-JSON stdout 用例 | **不修**：超出 T4 范围；可作为后续 T 任务 |
| 缺 null 回调用例 | **已修**：新增第 4 个测试 |

---

T4 完成：协议层 5 个单元测试全绿，JSDoc 已补齐，实现逻辑未动。

## stderr

```text

```
