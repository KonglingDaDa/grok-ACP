# Task 6: Minor 打磨 — 按钮与 Hover 优化

**任务编号：** T6  
**优先级：** P2（Minor）  
**预计耗时：** 5 分钟  
**超时：** 10 分钟  
**依赖：** T1-T5 完成

---

## 目标

修复 Hallmark 审计的 2 个 Minor 问题：

1. **删除按钮 opacity 过低** — 从 0.4 提升至 0.6
2. **卡片 hover shadow 跳跃感** — 延长 duration 或减小 spread

---

## 修改清单

### 1. 删除按钮 opacity 优化（`ui/src/styles/index.css`）

**当前值（第 158-166 行）：**
```css
.task-card-delete {
  opacity: 0.4;
  transition: opacity 120ms var(--ease-out);
  z-index: 1;
}

.task-card:hover .task-card-delete,
.task-card-delete:focus-visible {
  opacity: 1;
}
```

**目标值：**
```css
.task-card-delete {
  opacity: 0.6;  /* 从 0.4 提升至 0.6 */
  transition: opacity 120ms var(--ease-out);
  z-index: 1;
}

.task-card:hover .task-card-delete,
.task-card-delete:focus-visible {
  opacity: 1;
}
```

**改动原因：**
- opacity 0.4 过于隐蔽，用户可能注意不到删除功能
- 提升至 0.6 后，视觉上更容易发现，但仍保持"次要功能"的低调

---

### 2. 卡片 hover shadow 优化（`ui/src/styles/index.css`）

**当前值（第 141-155 行）：**
```css
.task-card {
  background: var(--color-paper-2);
  border: var(--rule-card) solid var(--color-rule);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  transition:
    border-color var(--dur-micro) var(--ease-out),
    box-shadow var(--dur-micro) var(--ease-out);
  cursor: pointer;
}

.task-card:hover {
  border-color: var(--color-rule-2);
  box-shadow: var(--shadow-hover);
}
```

**当前 shadow 定义（`tokens.css` 第 40-41 行）：**
```css
--shadow-card: 0 1px 2px oklch(0% 0 0 / 0.35);
--shadow-hover: 0 4px 16px oklch(0% 0 0 / 0.40);
```

**问题分析：**
- shadow 从 `1px blur + 2px spread` → `4px blur + 16px spread`，跳跃过大
- duration 只有 `--dur-micro`（120ms），配合大跳跃显得突兀

**修复方案：方案 A（推荐，延长 duration）**

修改 `index.css`：
```css
.task-card {
  /* ... */
  transition:
    border-color var(--dur-micro) var(--ease-out),
    box-shadow var(--dur-short) var(--ease-out);  /* 120ms → 240ms */
  cursor: pointer;
}
```

**修复方案：方案 B（备选，减小 shadow spread）**

修改 `tokens.css`：
```css
--shadow-hover: 0 4px 12px oklch(0% 0 0 / 0.40);  /* 16px → 12px */
```

**本次采用方案 A**（延长 duration），因为：
- 不修改 token 值，保持设计系统一致性
- 只改 transition timing，影响面更小
- 240ms 是 Hallmark 推荐的 `--dur-short` 值

---

## 验收标准

### 1. 视觉验证（Chrome DevTools MCP）

启动 `npm run dev`，用 Chrome DevTools MCP 截图对比：

**检查点 1：删除按钮可见性**
- [ ] 卡片未 hover 时，删除按钮 opacity 0.6（比之前更明显）
- [ ] 卡片 hover 时，删除按钮 opacity 1.0（完全可见）
- [ ] 用户能快速发现删除功能

**检查点 2：hover shadow 流畅性**
- [ ] 鼠标移入卡片时，shadow 过渡流畅（不突兀）
- [ ] 240ms duration 足够柔和
- [ ] shadow 从小到大平滑扩散

### 2. 功能验证

- [ ] 删除按钮点击正常
- [ ] 删除动画（fadeOut）正常
- [ ] 卡片 hover 不影响其他功能（点击打开面板）

### 3. 测试验证

```bash
npm run lint          # 无错误
npm run test:all      # 全部通过
npm run build         # 构建成功
```

---

## 技术细节

### 为什么 border-color 保持 120ms，shadow 改为 240ms

**不同属性的视觉敏感度不同：**

- **border-color** — 变化细微（rule → rule-2），120ms 足够
- **box-shadow** — 变化显著（1px → 4px blur, 2px → 16px spread），需要更长时间平滑过渡

**分离 transition duration：**
```css
transition:
  border-color 120ms ease-out,
  box-shadow 240ms ease-out;
```

这种"分层 timing"是微交互设计的常见技巧。

### 删除按钮 opacity 的心理学

**opacity 与用户发现概率的关系（粗略）：**

| Opacity | 视觉权重 | 用户发现时间 |
|---------|---------|-------------|
| 0.3 | 太弱 | > 5 秒（可能错过）|
| **0.4** | **弱**（当前） | ~3 秒 |
| **0.6** | **适中**（目标） | ~1 秒 |
| 0.8 | 强 | < 0.5 秒 |
| 1.0 | 最强 | 立即 |

**选择 0.6 的原因：**
- 足够明显，用户 1 秒内能发现
- 仍然低调，不抢主要内容的视觉焦点
- hover 时到 1.0 仍有明显变化（affordance 提示）

---

## Edge Cases 处理

### 1. Running 卡片的删除按钮

Running 卡片在 T2 中背景改为 `--color-paper-3`（更深）。

**影响：** 删除按钮在更深背景上，相同 opacity 会显得更不明显。

**验证：** 截图对比 Running 卡片和 Compact 卡片的删除按钮，确认 opacity 0.6 在两种背景上都足够可见。

### 2. 删除确认对话框

当前删除有两个入口：
- 卡片内删除按钮（TaskCard）
- "清理已结束"按钮（App.tsx，批量删除）

两者都有 `window.confirm` 确认，不受本次修改影响。

---

## 注意事项

1. **只改 CSS，不改 JS** — 纯样式优化，不涉及逻辑
2. **保持 ease-out** — 不改 easing curve，只改 duration
3. **测试 focus-visible** — 键盘导航时，删除按钮仍然 opacity 1.0（focus-visible 规则不变）

---

## 回退方案

如果 opacity 0.6 过于"吵"：
- **方案 1**：降至 0.5（折中）
- **方案 2**：保持 0.4，改用颜色提示（hover 时改为 `--color-down`）

如果 shadow duration 240ms 过慢：
- **方案 1**：缩短至 180ms（介于 120-240 之间）
- **方案 2**：改用方案 B（减小 `--shadow-hover` 的 spread）

---

**任务输出：**
- 修改后的 1 个文件（`index.css`）
- Chrome DevTools MCP 截图（删除按钮对比 + hover shadow 对比）
- 回执文档

---

**PM 签字：** Claude (Fable 5) — 2026-07-04 05:45
