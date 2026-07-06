# 任务 T3：toMetaContext 单元测试 + JSDoc (TDD)

**专题：** 2026-07-04-0340-AI友好化-测试与文档  
**PRD：** `./PRD.md`  
**任务编号：** T3  
**依赖：** T1（已完成）  
**创建时间：** 2026-07-04 04:08

---

## 背景

`src/dispatch-recorded.mjs` 的 `toMetaContext` 函数将 Grok session status 转换为监控 UI 的 `TaskContext` 对象。这是核心数据转换逻辑，包含累计消耗 token 的计算公式（`totalTokensBeforeCompaction + contextTokensUsed`）。

**PRD 路径：** `工程师任务/2026-07-04-0340-AI友好化-测试与文档/PRD.md`

**关键决策（来自 PRD §2.2）：**
- **TDD 模式：** 先写测试（红） → 写实现（绿） → 验收
- **测试覆盖：** 所有字段组合（齐全、部分缺失、null、压缩前后）

---

## 只允许修改这些文件

1. **新建** `test/dispatch-recorded.test.mjs` — 单元测试文件
2. **修改** `src/dispatch-recorded.mjs` — 补充 `toMetaContext` 的 JSDoc 注释（**不改变函数实现**）

**禁止**改动其他任何文件。不要改 `toMetaContext` 的实现逻辑（它已经正确），只补充 JSDoc。不要新增 npm 依赖。

---

## TDD 流程（你必须严格遵守这 5 步）

### 步骤 1：读需求

从下方"测试覆盖"章节读取 `toMetaContext` 的预期行为。

### 步骤 2：写测试

创建 `test/dispatch-recorded.test.mjs`（完整代码见下方）。

### 步骤 3：验证测试失败（红）

```bash
cd /home/desk/dev/repos/grokACP
npm test -- test/dispatch-recorded.test.mjs
```

**实际上当前实现已正确，所以这步可能直接绿**——重点是验证测试本身能跑。

### 步骤 4：写实现

**本任务的实现已存在**（`toMetaContext` 已正确实现），所以本步骤是**补充 JSDoc 注释**，不改代码逻辑。

### 步骤 5：验证测试通过（绿）

```bash
cd /home/desk/dev/repos/grokACP
npm test -- test/dispatch-recorded.test.mjs
```

**预期：** 所有测试通过（✓），零失败。

---

## 修改一：`test/dispatch-recorded.test.mjs` — 单元测试（可直接采用）

```js
import { describe, it } from "node:test";
import assert from "node:assert";
import { toMetaContext } from "../src/dispatch-recorded.mjs";

describe("toMetaContext", () => {
  it("returns null when status is null or undefined", () => {
    assert.strictEqual(toMetaContext(null), null);
    assert.strictEqual(toMetaContext(undefined), null);
  });

  it("converts full status to TaskContext", () => {
    const status = {
      status: { level: "ok" },
      contextTokensUsed: 50000,
      contextWindowUsage: 25.0,
      contextWindowTokens: 200000,
      totalTokensBeforeCompaction: 0,
      compactionCount: 0,
    };

    const result = toMetaContext(status);

    assert.deepStrictEqual(result, {
      level: "ok",
      totalTokens: 50000,
      usagePct: 25.0,
      windowTokens: 200000,
      consumedTokens: 50000,  // 0 + 50000
      compactionCount: 0,
    });
  });

  it("handles missing contextTokensUsed (returns null for derived fields)", () => {
    const status = {
      status: { level: "watch" },
      contextWindowUsage: 60.0,
      contextWindowTokens: 200000,
      totalTokensBeforeCompaction: 100000,
      compactionCount: 2,
    };

    const result = toMetaContext(status);

    assert.strictEqual(result.level, "watch");
    assert.strictEqual(result.totalTokens, null);
    assert.strictEqual(result.consumedTokens, null);  // null + 100000 → null
    assert.strictEqual(result.compactionCount, 2);
  });

  it("calculates consumedTokens correctly after compaction", () => {
    const status = {
      status: { level: "medium" },
      contextTokensUsed: 120000,
      contextWindowUsage: 60.0,
      contextWindowTokens: 200000,
      totalTokensBeforeCompaction: 1261844,  // 8 次压缩的累计（探测任务实测值）
      compactionCount: 8,
    };

    const result = toMetaContext(status);

    assert.strictEqual(result.consumedTokens, 1381844);  // 1261844 + 120000
    assert.strictEqual(result.compactionCount, 8);
  });

  it("handles missing optional fields gracefully", () => {
    const status = {
      status: { level: "high" },
      contextTokensUsed: 150000,
      contextWindowUsage: 75.0,
      // contextWindowTokens, totalTokensBeforeCompaction, compactionCount 缺失
    };

    const result = toMetaContext(status);

    assert.strictEqual(result.level, "high");
    assert.strictEqual(result.totalTokens, 150000);
    assert.strictEqual(result.windowTokens, null);
    assert.strictEqual(result.consumedTokens, 150000);  // 0 + 150000（totalTokensBeforeCompaction 默认 0）
    assert.strictEqual(result.compactionCount, 0);  // 默认 0
  });

  it("handles status.status missing (level becomes null)", () => {
    const status = {
      contextTokensUsed: 10000,
      contextWindowUsage: 5.0,
    };

    const result = toMetaContext(status);

    assert.strictEqual(result.level, null);
    assert.strictEqual(result.totalTokens, 10000);
  });
});
```

**测试覆盖：**
- null/undefined 输入
- 所有字段齐全（无压缩）
- `contextTokensUsed` 缺失 → `consumedTokens` 为 null
- 多次压缩后（`totalTokensBeforeCompaction` 很大）
- 部分字段缺失（默认值）
- `status.status` 缺失（level 为 null）

---

## 修改二：`src/dispatch-recorded.mjs` — 补充 JSDoc

在 `toMetaContext` 函数前加 JSDoc 注释（可直接采用）：

```js
/**
 * 将 Grok session status 转换为监控 UI 的 TaskContext 对象。
 * 
 * @param {Object} status - session-store.mjs 的 getSessionStatus() 返回值
 * @param {Object} [status.status] - 上下文状态对象
 * @param {string} [status.status.level] - 上下文等级：ok/watch/medium/high/critical
 * @param {number} [status.contextTokensUsed] - 当前上下文已用 token 数
 * @param {number} [status.contextWindowUsage] - 上下文占用百分比（0-100）
 * @param {number} [status.contextWindowTokens] - 上下文窗口总长（如 Composer 200000、Grok 4.3 500000）
 * @param {number} [status.totalTokensBeforeCompaction] - 历次压缩前 token 的累计和（跨压缩只增不减）
 * @param {number} [status.compactionCount] - 压缩次数
 * @returns {{
 *   level: string | null,
 *   totalTokens: number | null,
 *   usagePct: number | null,
 *   windowTokens: number | null,
 *   consumedTokens: number | null,
 *   compactionCount: number
 * } | null} 返回格式化后的上下文对象；status 为 null/undefined 时返回 null
 * 
 * @example
 * // 无压缩会话
 * toMetaContext({
 *   status: { level: 'ok' },
 *   contextTokensUsed: 50000,
 *   contextWindowUsage: 25.0,
 *   contextWindowTokens: 200000,
 *   totalTokensBeforeCompaction: 0,
 *   compactionCount: 0
 * })
 * // => { level: 'ok', totalTokens: 50000, usagePct: 25.0, windowTokens: 200000, consumedTokens: 50000, compactionCount: 0 }
 * 
 * // 多次压缩后
 * toMetaContext({
 *   status: { level: 'medium' },
 *   contextTokensUsed: 120000,
 *   totalTokensBeforeCompaction: 1261844,  // 8 次压缩累计
 *   compactionCount: 8
 * })
 * // => { ..., consumedTokens: 1381844, compactionCount: 8 }
 */
export function toMetaContext(status) {
  if (!status) return null;
  const used = status.contextTokensUsed ?? null;
  const compactedBefore = status.totalTokensBeforeCompaction ?? 0;
  return {
    level: status.status?.level ?? null,
    totalTokens: used,
    usagePct: status.contextWindowUsage ?? null,
    windowTokens: status.contextWindowTokens ?? null,
    consumedTokens: used === null ? null : used + compactedBefore,
    compactionCount: status.compactionCount ?? 0,
  };
}
```

**注意：** 只加 JSDoc，**不要改变函数实现**（函数已经正确）。

---

## 验收（你必须自己执行并在回执中给出结果）

### 步骤 1：运行测试（红 → 绿验证）

```bash
cd /home/desk/dev/repos/grokACP
npm test -- test/dispatch-recorded.test.mjs
```

**预期输出：** 所有测试通过（✓），类似：

```
✔ toMetaContext (6)
  ✔ returns null when status is null or undefined
  ✔ converts full status to TaskContext
  ✔ handles missing contextTokensUsed
  ✔ calculates consumedTokens correctly after compaction
  ✔ handles missing optional fields gracefully
  ✔ handles status.status missing

Test Files  1 passed (1)
Tests  6 passed (6)
```

### 步骤 2：验证 JSDoc 注释（人工检查）

```bash
cd /home/desk/dev/repos/grokACP
grep -A 10 "@param\|@returns\|@example" src/dispatch-recorded.mjs | head -30
```

**预期输出：** `toMetaContext` 有完整的 `@param`、`@returns`、`@example` 注释。

### 步骤 3：验证 lint 不回归

```bash
cd /home/desk/dev/repos/grokACP
npm run lint 2>&1 | grep "dispatch-recorded.mjs"
```

**预期输出：** 无错误（`node --check` 通过）。

---

## 收工前自审（小改动，可跳过 Critic）

本任务只新增测试文件 + 补充 JSDoc，改动 ≤ 2 个文件，无共享入口，**可以跳过 Critic 自审**。

---

## 回复格式

修改的文件清单、每个文件的关键改动点、验收命令输出结果（3 个步骤）、是否跳过 Critic（说明"小改动，无 Critic 自审"）。
