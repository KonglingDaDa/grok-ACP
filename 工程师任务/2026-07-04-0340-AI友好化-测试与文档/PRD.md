# PRD：grokACP AI 友好化 — 测试与文档

**创建时间：** 2026-07-04 03:40  
**PM：** Claude (Fable 5)  
**执行工程师：** Grok Composer 2.5 Fast (via grokACP)

---

## 1. 背景与动机

### 1.1 当前问题

grokACP 是零依赖 Node.js ESM 项目，作为 Grok CLI 的 ACP 调度器。当前对 AI agent（Claude/Grok）的友好度存在以下问题：

1. **缺少单元测试** — 只有端到端 smoke 测试，AI 改代码时无法细粒度验证"改了 A 不会破坏 B"。
2. **JSDoc 注释稀疏** — 关键函数（`toMetaContext`、`GrokAcpClient` 构造器、`createTaskRecorder` 回调）没有类型注释和语义说明，AI 需要反复读代码推断。
3. **错误信息不够具体** — `catch (err) { throw new Error(\`JSON-RPC error: ${err.message}\`) }` 这种错误，AI 看到时不知道是网络超时、协议不匹配还是 Grok CLI 没启动。

### 1.2 目标用户

**主要用户：** AI agent（Claude/Grok）在维护、扩展 grokACP 时。  
**次要用户：** 人类开发者快速理解代码、验证改动。

### 1.3 用户价值

- **AI agent** — 通过测试快速验证改动、通过 JSDoc 理解 API、通过具体错误信息定位问题，减少"盲改-运行-失败-再改"的循环次数。
- **人类开发者** — 测试作为活文档，JSDoc 作为类型提示，错误信息作为调试线索。

---

## 2. 技术方案

### 2.1 测试框架选型

**选择：Node.js 原生 `node:test`（Node 20+）**

理由：
- **零依赖** — 符合项目"零 npm 依赖"原则
- **内置** — Node 20+ 自带，无需安装 Jest/Mocha/Vitest
- **ESM 原生支持** — 直接 `import` `.mjs` 文件
- **足够用** — 支持 `describe`/`it`/`assert`，满足单元测试需求

**不选 Jest/Vitest** — 需要 npm 依赖，与项目原则冲突。

**测试文件命名：** `<name>.test.mjs`（例如 `format.test.mjs`）

**测试目录结构：**

```
grokACP/
  src/
    format.mjs
    task-recorder.mjs
    acp-client.mjs
  test/
    format.test.mjs           # 纯函数单元测试
    task-recorder.test.mjs    # 逻辑单元测试（需要 mock fs）
    acp-client.test.mjs       # 协议层测试（需要 mock stdio）
```

**运行命令：**

```bash
node --test                   # 运行所有 *.test.mjs
node --test test/format.test.mjs   # 运行单个测试
```

**package.json 新增脚本：**

```json
"scripts": {
  "test": "node --test",
  "test:watch": "node --test --watch"
}
```

### 2.2 TDD 模式约定

**Grok Composer 2.5 的 TDD 流程（任务文档必须明确这 5 步）：**

1. **读需求** — 从任务文档读取要实现的功能、输入输出示例
2. **写测试** — 先写测试文件，包含所有边界情况（空值、负数、超大值、异常输入）
3. **验证测试失败** — 跑 `npm test`，确认测试红（因为实现还没写）
4. **写实现** — 实现功能，通过测试
5. **验证测试通过** — 跑 `npm test`，确认测试绿

**任务文档的验收章节必须包含：**

```bash
# 步骤 3：验证测试失败（预期）
npm test 2>&1 | grep "tests 0 passed"   # 或其他失败输出

# 步骤 5：验证测试通过（最终）
npm test   # 必须全绿
```

### 2.3 JSDoc 注释规范

**必须注释的符号：**
1. 导出函数的参数、返回值
2. 导出类的构造器参数、公开方法
3. 复杂逻辑的内部函数（如果语义不明显）

**注释模板：**

```js
/**
 * 将 Grok session status 转换为监控 UI 的 TaskContext 对象。
 * 
 * @param {Object} status - session-store.mjs 的 getSessionStatus() 返回值
 * @param {number} [status.contextTokensUsed] - 当前上下文已用 token 数
 * @param {number} [status.contextWindowUsage] - 上下文占用百分比（0-100）
 * @param {number} [status.contextWindowTokens] - 上下文窗口总长（如 200000）
 * @param {number} [status.totalTokensBeforeCompaction] - 历次压缩前 token 累计和
 * @param {number} [status.compactionCount] - 压缩次数
 * @returns {TaskContext | null} 返回格式化后的上下文对象，status 为空时返回 null
 */
export function toMetaContext(status) {
  if (!status) return null;
  // ...
}
```

**不要注释的：**
- 函数内部的临时变量（除非算法复杂）
- 显而易见的逻辑（如 `const sum = a + b`）

### 2.4 错误信息增强规范

**原则：错误信息必须包含"发生了什么 + 当时状态 + 如何排查"三要素。**

**反例（当前代码）：**

```js
} catch (err) {
  throw new Error(`JSON-RPC error: ${err.message}`);
}
```

**正例（改进后）：**

```js
} catch (err) {
  throw new Error(
    `JSON-RPC ${method} failed: ${err.message}\n` +
    `Session: ${this.sessionId || 'not initialized'}\n` +
    `State: ${this.state}\n` +
    `Hint: Check if Grok CLI is running and ACP stdio is responsive.`
  );
}
```

---

## 3. 任务拆解

### Task 1：搭建测试框架（基础设施）

**目标：** 配置 Node.js 原生测试 + 改造 smoke 脚本 + 文档更新

**产物：**
- `test/` 目录 + `.gitkeep`
- `package.json` 新增 `"test"` 和 `"test:watch"` 脚本
- `test/smoke.test.mjs`（将现有 `npm run smoke` 改造为测试）
- `CLAUDE.md` 和 `README.md` 补充测试章节

### Task 2：`ui/src/lib/format.ts` 单元测试 + JSDoc（TDD）

**目标：** 为 `formatCount`、`formatCardTime`、`shortModel` 写测试和 JSDoc

**为什么先选这个：** 纯函数、无依赖、最简单，作为 TDD 示例

**测试覆盖：**
- `formatCount(200000)` → `"200k"`
- `formatCount(12400)` → `"12.4k"`
- `formatCount(999)` → `"999"`
- `formatCount(1500000)` → `"1.5m"`
- `formatCount(0)` → `"0"`
- `formatCount(NaN)` → `"0"`
- `formatCount(Infinity)` → `"0"`

### Task 3：`src/dispatch-recorded.mjs` 的 `toMetaContext` 测试 + JSDoc（TDD）

**目标：** 为 `toMetaContext` 写测试和 JSDoc

**测试覆盖：**
- 正常输入（所有字段齐全）
- 部分字段缺失（`contextTokensUsed` 为 null）
- `status` 为 null → 返回 null
- `totalTokensBeforeCompaction` 为 0（无压缩）→ `consumedTokens === contextTokensUsed`
- `totalTokensBeforeCompaction` 为 1261844（多次压缩）→ `consumedTokens === 1261844 + contextTokensUsed`

### Task 4：`src/acp-client.mjs` 协议层测试 + JSDoc（TDD）

**目标：** 为 `GrokAcpClient` 写测试和 JSDoc（需要 mock stdio）

**测试覆盖：**
- 成功流程：initialize → authenticate → session/new → session/prompt
- 错误处理：JSON-RPC 超时、协议版本不匹配、Grok CLI 进程提前退出
- onChunk 回调触发（mock `session/update`）
- onToolEvent 回调触发（mock `tool_call`）

**难点：** 需要 mock `child_process.spawn` 和 stdio 流，这部分可能需要辅助工具（如 Node.js 的 `stream.Readable`/`Writable`）

### Task 5：ACP 错误上下文增强

**目标：** 改进 `acp-client.mjs` 和 `task-recorder.mjs` 的 catch 块

**改进点：**
- JSON-RPC 错误加上 method、sessionId、state
- 文件 IO 错误加上文件路径、操作类型
- 超时错误加上等待时长、建议

---

## 4. 验收标准

### 4.1 硬门禁

1. **所有新增测试必须通过** — `npm test` 零错误
2. **原有 smoke 测试不能回归** — `npm run smoke` 和 `npm run smoke:write` 必须仍然通过
3. **零 npm 依赖不能破坏** — `package.json` 的 `dependencies` 和 `devDependencies` 必须为空或不存在
4. **所有导出函数必须有 JSDoc** — 至少包含 `@param` 和 `@returns`

### 4.2 测试覆盖率目标（非强制）

- **纯函数（format.ts、toMetaContext）** — 100% 分支覆盖
- **有副作用的函数（task-recorder、acp-client）** — ≥80% 分支覆盖
- **UI 组件** — 本次不要求（P3 任务）

---

## 5. 技术约束

1. **零 npm 依赖** — 不得引入 Jest/Mocha/Vitest/Sinon 等测试库
2. **Node 20+ 原生 API** — 只用 `node:test`、`node:assert`、`node:stream`
3. **ESM 模块** — 测试文件必须是 `.mjs`，用 `import` 而不是 `require`
4. **不改变现有 API** — 测试和 JSDoc 是"加法"，不能改变导出函数的签名或行为
5. **TDD 必须真跑** — 任务文档要求 Grok 先跑测试看到红，再写实现看到绿，回执必须贴两次测试输出

---

## 6. 非目标（本次不做）

- **集成测试** — 不测试"grok-acp run 真的能派发任务"（已有 smoke 覆盖）
- **UI 组件测试** — React Testing Library 需要额外依赖，P3 任务再做
- **性能测试** — 当前规模不需要
- **AGENTS.md** — 用户明确不做

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| `node:test` 在 Node 18 不可用 | CI/旧环境无法跑测试 | 文档说明"测试需要 Node 20+"，`package.json` 加 `"engines": { "node": ">=20.0.0" }` |
| mock stdio 很复杂 | Task 4 可能 BLOCKED | 先做 Task 2/3（纯函数），Task 4 如果 blocked 可以降级为"只测 happy path" |
| TDD 模式 Grok 不熟悉 | 任务文档理解偏差 | 任务文档给完整的"先写测试 → 跑红 → 写实现 → 跑绿"流程，配代码示例 |

---

## 8. 后续演进

完成本 PRD 的 5 个任务后，后续可以：

- **P3：UI 组件测试** — 引入 Vitest（打破零依赖约束，需要用户批准）
- **P4：CI 集成** — GitHub Actions 自动跑 `npm test`
- **P5：覆盖率报告** — `c8` 或 `node --experimental-test-coverage`

---

**版本：** v1.0  
**最后更新：** 2026-07-04 03:40
