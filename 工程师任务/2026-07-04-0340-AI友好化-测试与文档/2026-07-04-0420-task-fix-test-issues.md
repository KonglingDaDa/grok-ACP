# 任务：修正测试配置问题

**专题：** 2026-07-04-0340-AI友好化-测试与文档  
**优先级：** 高（验收阻塞）  
**创建时间：** 2026-07-04 04:20

---

## 背景

当前测试有两个小问题需要修正：

1. **smoke.test.mjs 的 doctor 测试失败** — 断言期望 `/grok binary:/`，实际输出是 `grok: grok 0.2.82 ...`（Grok CLI 输出格式变化）
2. **npm test 包含 TypeScript 测试文件** — `npm test` 在根目录运行时尝试编译 `ui/src/lib/format.test.ts`，但 Node.js 原生 `--test` 不支持 TypeScript

---

## 只允许修改这些文件

1. **修改** `test/smoke.test.mjs` — 修正 doctor 测试的断言
2. **修改** `package.json` — 配置 `test` 脚本只运行后端测试（`.mjs`）
3. **新建** `package.json` 的 `test:ui` 脚本 — 运行前端测试（TypeScript）

**禁止**改动其他任何文件。

---

## 修改一：`test/smoke.test.mjs` — 修正 doctor 测试断言

找到 `it("grok-acp doctor should succeed")` 测试，将这一行：

```js
assert.match(result.stdout, /grok binary:/, "Expected stdout to contain grok binary info");
```

改为（匹配实际输出格式）：

```js
assert.match(result.stdout, /grok:/i, "Expected stdout to contain grok info");
```

**说明：** Grok CLI 的 doctor 输出格式是 `grok: grok 0.2.82 ...`，用 `/grok:/i` 匹配（不区分大小写）更宽松且准确。

---

## 修改二：`package.json` — 拆分测试脚本

在 `"scripts"` 部分修改 `test` 和 `test:watch`，并新增 `test:ui`：

```json
{
  "scripts": {
    "doctor": "...",
    "smoke": "...",
    "lint": "...",
    "test": "node --test test/**/*.test.mjs",
    "test:watch": "node --test --watch test/**/*.test.mjs",
    "test:ui": "npm --prefix ui run test",
    "test:all": "npm run test && npm run test:ui"
  }
}
```

**说明：**
- `test` — 只运行后端测试（`test/**/*.test.mjs`），用 Node.js 原生 `--test`
- `test:ui` — 运行前端测试（进入 `ui/` 目录执行 `npm run test`）
- `test:all` — 同时运行后端和前端测试

---

## 修改三：`ui/package.json` — 新增前端测试脚本（如果不存在）

**先检查 `ui/package.json` 是否已有 `"test"` 脚本：**

```bash
grep '"test"' ui/package.json
```

**如果没有**，在 `ui/package.json` 的 `"scripts"` 部分新增：

```json
{
  "scripts": {
    "dev": "...",
    "build": "...",
    "preview": "...",
    "test": "vitest run"
  }
}
```

**如果已有**，跳过本步骤，在回执中说明"ui/package.json 已有 test 脚本"。

---

## 验收（你必须自己执行并在回执中给出结果）

### 步骤 1：验证后端测试全通过

```bash
cd /home/desk/dev/repos/grokACP
npm test
```

**预期输出：** 所有后端测试通过（✓），包括之前失败的 doctor 测试。类似：

```
✔ smoke tests (2)
  ✔ grok-acp run with inline prompt should succeed
  ✔ grok-acp doctor should succeed
✔ toMetaContext (6)
  ...

Test Files  2 passed (2)
Tests  8 passed (8)
```

### 步骤 2：验证前端测试全通过

```bash
cd /home/desk/dev/repos/grokACP
npm run test:ui
```

**预期输出：** 前端测试通过（9 个 format 测试）。

### 步骤 3：验证 test:all 脚本

```bash
cd /home/desk/dev/repos/grokACP
npm run test:all 2>&1 | grep -E "Test Files|Tests"
```

**预期输出：** 显示后端和前端测试的总结。

---

## 收工前自审（小改动，跳过 Critic）

只修改测试配置，无需 Critic 自审。

---

## 回复格式

修改的文件清单、每个文件的关键改动点、验收命令输出结果（3 个步骤）。
