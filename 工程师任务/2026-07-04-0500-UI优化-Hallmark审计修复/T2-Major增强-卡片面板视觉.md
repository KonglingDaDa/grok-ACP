# Task 2: Major 增强 — 卡片与面板视觉层级

**任务编号：** T2  
**优先级：** P1  
**预计耗时：** 10 分钟  
**超时：** 15 分钟  
**依赖：** T1 完成

---

## 目标

修复 Hallmark 审计的 2 个 Major 问题：

1. **Running 卡片无视觉层级变化** — 增强 Running 状态卡片的视觉权重
2. **详情面板缺少空间感** — DetailPanel 动效叠加 Y 轴位移

---

## 修改清单

### 1. Running 卡片视觉增强

**当前问题（`ui/src/components/TaskCard.tsx`）：**
- Running 和 Compact 卡片只通过左侧 2px 条纹区分
- padding、背景色、box-shadow 完全一致
- 视觉上"不够活跃"

**目标改进：**

#### 1.1 增加 padding（第 230 行附近，RunningCard）

```tsx
function RunningCard({ task, samples, demo, onOpen, ensureSamples, removeTask, markRemoving, clearRemoving, cardRef, flashRef }: RunningCardProps) {
  // ... 现有逻辑 ...

  return (
    <CardShell task={task} status="running" onOpen={onOpen} className="flex flex-col gap-sm" cardRef={cardRef} flashRef={flashRef}>
      {/* 改：padding 从 p-md 改为 p-lg，在 CardShell 的 className 里已经设置，这里需要修改 CardShell */}
      {/* ... children ... */}
    </CardShell>
  )
}
```

**实际修改点：CardShell 的 p-md（第 156 行）**

改为动态 padding：
```tsx
function CardShell({ task, status, onOpen, className, children, cardRef, flashRef }: CardShellProps) {
  const accentLeft = status === 'running'
  const downLeft = status === 'error'
  const isRunning = status === 'running'

  // ... handleKeyDown ...

  return (
    <article
      ref={cardRef}
      data-card-id={task.id}
      className={`task-card relative ${isRunning ? 'p-lg' : 'p-md'} ${className}`}  {/* 动态 padding */}
      style={{
        borderRadius: 'var(--radius-card)',
        background: isRunning ? 'var(--color-paper-3)' : 'var(--color-paper-2)',  {/* 动态背景 */}
        ...(accentLeft || downLeft
          ? { borderLeftWidth: 2, borderLeftColor: accentLeft ? 'var(--color-up)' : 'var(--color-down)' }
          : {}),
        ...(accentLeft ? { boxShadow: 'var(--shadow-card), var(--glow-live)' } : {}),
      }}
      {/* ... rest ... */}
    >
      {/* ... children ... */}
    </article>
  )
}
```

**关键改动：**
- Running 卡片 padding: `p-lg`（1.5rem）vs Compact 的 `p-md`（1rem）
- Running 卡片 background: `--color-paper-3` vs Compact 的 `--color-paper-2`
- 保持现有 glow 和左侧条纹

---

### 2. DetailPanel 动效增强

**当前问题（`ui/src/components/DetailPanel.tsx` 第 77-84 行）：**
```tsx
gsap.fromTo(
  panel,
  { scale: 0.96, autoAlpha: 0, transformOrigin: '50% 50%' },
  { scale: 1, autoAlpha: 1, duration: 0.26, ease: 'token-ease-out' },
)
```

只有 scale + opacity，缺少 Y 轴位移，modal 从中心"弹出"而非"浮现"。

**目标改进：叠加 Y 轴位移**

```tsx
gsap.fromTo(
  panel,
  { scale: 0.96, autoAlpha: 0, y: 12, transformOrigin: '50% 50%' },  // 添加 y: 12
  { scale: 1, autoAlpha: 1, y: 0, duration: 0.26, ease: 'token-ease-out' },  // 添加 y: 0
)
```

**关键改动：**
- 从 `y: 12px`（向下偏移）动画到 `y: 0`
- 配合 scale，形成"从远到近浮现"的感觉
- 保持 duration 和 ease 不变

---

## 验收标准

### 1. 视觉验证（Chrome DevTools MCP）

启动 `npm run dev`，用 Chrome DevTools MCP 截图对比：

**检查点 1：Running 卡片更突出**
- [ ] Running 卡片明显比 Compact 卡片"更大"（padding 差异可见）
- [ ] Running 卡片背景更深（paper-3 vs paper-2）
- [ ] 运行中任务在网格中"跳出来"

**检查点 2：DetailPanel 动效更流畅**
- [ ] 点击卡片打开面板时，有"从下方浮起"的感觉
- [ ] 不再是纯粹的"中心弹出"
- [ ] 关闭动画同步（y: 0 → 12）

### 2. 功能验证

- [ ] 卡片删除、Tab 切换、SSE 更新正常
- [ ] 面板打开/关闭（Esc、mask 点击、关闭按钮）正常
- [ ] prefers-reduced-motion 下动效降级正常

### 3. 测试验证

```bash
npm run lint          # 无错误
npm run test:all      # 全部通过
npm run build         # 构建成功
```

---

## 技术细节

### Running 卡片的视觉层级

**Before（T1 前）：**
- padding: 1rem (16px)
- background: oklch(24% 0.020 260)
- 左侧 2px up 条纹 + glow

**After（T2 后）：**
- padding: 1.5rem (24px) ← +8px 每边
- background: oklch(30% 0.022 260) ← 更深
- 左侧 2px up 条纹 + glow（保持）

**视觉效果：**
- Running 卡片"占地更大"，在网格中更突出
- 背景更深，与 Compact 形成明显对比
- 配合 LED 呼吸（T5 会优化），形成"活跃"的视觉语言

### DetailPanel Y 轴动效

**物理隐喻：**
- 从 `y: 12px`（屏幕下方偏移）→ `y: 0`（中心）
- 配合 `scale: 0.96 → 1.0`
- 形成"从远到近、从下浮起"的深度感

**Ease curve：**
- `token-ease-out` 即 `cubic-bezier(0.16, 1, 0.3, 1)`
- 快速启动、平滑减速，符合自然物理

**Reduced motion fallback：**
- 已在 `motionSafe()` 中处理（第 43-55 行）
- prefers-reduced-motion 下：duration 减半（260ms → 130ms），去掉 scale 和 y，只保留 opacity

---

## 注意事项

1. **CardShell 是共享组件** — Running/Compact/Error 都用它，修改时注意条件判断
2. **useGSAP dependencies** — DetailPanel 的 useGSAP 已经有 `dependencies: [open, mounted]`，不需要修改
3. **CSS var 引用** — `--color-paper-3` 在 T1 中已经提升 chroma，这里直接引用即可
4. **不修改 flash 动画** — 状态翻转的 flash（第 433-447 行）保持不变

---

## 回退方案

如果 Running 卡片视觉过于"重"：
- 回退 padding：`p-lg` → `p-md`（保持背景色改动）
- 或回退背景：`--color-paper-3` → `--color-paper-2`（保持 padding 改动）

如果 Y 轴动效不协调：
- 减小位移：`y: 12` → `y: 6`
- 或改为 blur：`filter: blur(4px) → blur(0)`（替代 Y 轴）

---

**任务输出：**
- 修改后的 2 个文件（`TaskCard.tsx`, `DetailPanel.tsx`）
- Chrome DevTools MCP 截图（Running 卡片对比 + 面板动效截图）
- 回执文档

---

**PM 签字：** Claude (Fable 5) — 2026-07-04 05:25
