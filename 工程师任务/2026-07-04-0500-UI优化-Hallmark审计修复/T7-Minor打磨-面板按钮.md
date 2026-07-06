# Task 7: Minor 打磨 — 面板与按钮视觉优化

**任务编号：** T7  
**优先级：** P2（Minor）  
**预计耗时：** 6 分钟  
**超时：** 10 分钟  
**依赖：** T1-T5 完成

---

## 目标

修复 Hallmark 审计的 2 个 Minor 问题：

1. **详情面板滚动条未定制** — 从 10px 宽改为 6px overlay 滚动条
2. **"清理已结束"按钮视觉权重过弱** — 改用 `--color-down` 颜色 + 半透明背景

---

## 修改清单

### 1. 详情面板滚动条优化（`ui/src/components/DetailPanel.tsx`）

**当前问题：**
- 面板 `overflowY: auto`，但滚动条继承全局样式（10px 宽）
- 在宽度有限的 modal 中，10px 滚动条过粗

**目标改进：**

在 DetailPanel 的 `<div>` 上添加自定义滚动条样式（inline style 或 className）：

```tsx
<div
  ref={panelRef}
  role="dialog"
  aria-modal="true"
  aria-label={`${activeTask.name} detail`}
  className="flex flex-col p-md custom-scrollbar"  // 添加 custom-scrollbar class
  style={{
    pointerEvents: 'auto',
    width: 'min(960px, 94vw)',
    maxHeight: 'min(88vh, 1000px)',
    overflowY: 'auto',
    background: 'var(--color-paper-2)',
    border: 'var(--rule-card) solid var(--color-rule)',
    borderRadius: 'var(--radius-card)',
    boxShadow: 'var(--shadow-hover)',
  }}
>
  {/* 现有内容 */}
</div>
```

**在 `ui/src/styles/index.css` 添加：**

```css
/* DetailPanel 细滚动条（§7.3） */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;  /* 透明轨道，更轻量 */
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--color-rule-2);
  border-radius: 3px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--color-muted);
}
```

**改动原因：**
- 6px 宽度在 modal 中更协调
- 透明轨道减少视觉噪音
- hover 时加深颜色，提供反馈

---

### 2. "清理已结束"按钮优化（`ui/src/App.tsx`）

**当前样式（第 85-98 行）：**
```tsx
<button
  type="button"
  onClick={handleClearFinished}
  className="mono-label shrink-0 px-xs py-2xs text-xs"
  style={{
    border: '1px solid var(--color-rule-2)',
    borderRadius: 'var(--radius-pill)',
    color: 'var(--color-muted)',
    background: 'transparent',
  }}
>
  清理已结束 ({finishedCount})
</button>
```

**问题分析：**
- `color: muted` + `background: transparent` 视觉权重很弱
- 但实际是批量删除的危险操作，应该有更明显的警示

**目标样式：**
```tsx
<button
  type="button"
  onClick={handleClearFinished}
  className="mono-label shrink-0 px-xs py-2xs text-xs clear-finished-btn"  // 添加 class
  style={{
    border: '1px solid var(--color-down)',  // muted → down（红色）
    borderRadius: 'var(--radius-pill)',
    color: 'var(--color-down)',  // muted → down
    background: 'oklch(65% 0.19 25 / 0.08)',  // 半透明红色背景
  }}
>
  清理已结束 ({finishedCount})
</button>
```

**在 `ui/src/styles/index.css` 添加 hover 样式：**

```css
/* "清理已结束"按钮 hover 增强 */
.clear-finished-btn {
  transition:
    background var(--dur-micro) var(--ease-out),
    border-color var(--dur-micro) var(--ease-out);
}

.clear-finished-btn:hover {
  background: oklch(65% 0.19 25 / 0.15);  /* 0.08 → 0.15 */
  border-color: var(--color-down);
}
```

**改动原因：**
- 使用 `--color-down`（错误/危险语义色）而非 muted
- 半透明红色背景（0.08 opacity）提示危险性，但不过于"吵"
- hover 时背景加深至 0.15，提供明确反馈

---

## 验收标准

### 1. 视觉验证（Chrome DevTools MCP）

启动 `npm run dev`，用 Chrome DevTools MCP 截图对比：

**检查点 1：面板滚动条**
- [ ] 打开任意长内容的详情面板（如大 prompt）
- [ ] 滚动条宽度 6px（比全局 10px 更细）
- [ ] 轨道透明，thumb 为 `--color-rule-2` 灰色
- [ ] hover 滚动条时，thumb 变为 `--color-muted`（更深）

**检查点 2："清理已结束"按钮**
- [ ] 按钮边框和文字为红色（`--color-down`）
- [ ] 背景为半透明红色（subtle but visible）
- [ ] hover 时背景加深（视觉反馈明显）
- [ ] 点击后弹出确认对话框（功能正常）

### 2. 功能验证

- [ ] 面板滚动流畅，无卡顿
- [ ] 滚动条在 Firefox / Safari 中降级为默认样式（可接受）
- [ ] "清理已结束"按钮点击正常
- [ ] 批量删除确认、动画正常

### 3. 测试验证

```bash
npm run lint          # 无错误
npm run test:all      # 全部通过
npm run build         # 构建成功
```

---

## 技术细节

### 为什么用 6px 而非更细（如 4px）

**滚动条宽度的可用性权衡：**

| 宽度 | 优点 | 缺点 |
|------|------|------|
| 10px | 易抓取 | 占空间，视觉重 |
| **6px** | **平衡**（目标） | 抓取稍难 |
| 4px | 轻量 | 难以精确抓取 |

**选择 6px 的原因：**
- macOS / Windows 默认滚动条约 8-12px
- 6px 是细化但仍可用的下限
- 配合 `border-radius: 3px`，视觉更精致

### 为什么"清理已结束"用 down 而非 warn

**语义色选择：**

| 颜色 | 语义 | 适用场景 |
|------|------|----------|
| `--color-up` | 成功 / 运行中 | 正向操作 |
| `--color-warn` | 警告 / 中断 | 可逆警告 |
| **`--color-down`** | **错误 / 危险** | **不可逆操作**（目标）|

**"清理已结束"是危险操作：**
- 批量删除，不可逆（虽然有确认对话框）
- 用 `down`（红色）符合用户心理预期
- `warn`（黄色）更适合"上下文即将压缩"之类的警告

### 半透明背景的 opacity 选择

**背景 opacity 与视觉权重：**

| Opacity | 效果 |
|---------|------|
| 0.05 | 太弱，几乎看不出 |
| **0.08** | **默认态**（目标：subtle but visible）|
| **0.15** | **hover 态**（目标：明确反馈）|
| 0.25 | 过强，抢主要内容焦点 |

---

## Edge Cases 处理

### 1. 面板内容过短（无滚动）

如果面板内容少于 `maxHeight`，不会出现滚动条。

自定义滚动条样式不影响（只在 `::-webkit-scrollbar` 生效时应用）。

### 2. Firefox 不支持 `::-webkit-scrollbar`

**Fallback：** Firefox 会使用系统默认滚动条。

**影响：** 视觉稍差，但功能正常（可接受的 graceful degradation）。

**改进（可选，本次不实现）：**
- 用 `scrollbar-width: thin` + `scrollbar-color`（Firefox 专有属性）
- 或用 JS 实现的虚拟滚动条（过度工程）

### 3. "清理已结束"按钮在没有已结束任务时不显示

当前逻辑：`finishedCount > 0 ? <button> : undefined`（App.tsx 第 84 行）

不受本次修改影响。

---

## 注意事项

1. **滚动条样式仅限 DetailPanel** — 不修改全局 `::-webkit-scrollbar`（会影响整个页面）
2. **半透明红色背景** — 使用 inline `oklch(65% 0.19 25 / 0.08)` 而非新 token（避免 token 膨胀）
3. **测试 hover / active 状态** — 确认 active 时的 `opacity: 0.75` 规则仍然生效（全局规则，第 179-182 行）

---

## 回退方案

如果滚动条 6px 过细：
- **方案 1**：改为 8px（介于 6-10 之间）
- **方案 2**：保持 10px，只改 `scrollbar-track` 透明

如果"清理已结束"按钮过于"吵"：
- **方案 1**：降低背景 opacity（0.08 → 0.05）
- **方案 2**：改用 `--color-warn`（黄色）而非 `down`（红色）

---

**任务输出：**
- 修改后的 2 个文件（`DetailPanel.tsx`, `App.tsx`, `index.css`）
- Chrome DevTools MCP 截图（滚动条对比 + 按钮对比）
- 回执文档

---

**PM 签字：** Claude (Fable 5) — 2026-07-04 05:50
