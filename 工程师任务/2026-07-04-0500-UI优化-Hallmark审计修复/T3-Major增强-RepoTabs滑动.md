# Task 3: Major 增强 — Repo Tabs 下划线滑动动画

**任务编号：** T3  
**优先级：** P1  
**预计耗时：** 8 分钟  
**超时：** 12 分钟  
**依赖：** T1 完成

---

## 目标

修复 Hallmark 审计的 1 个 Major 问题：

**Repo Tabs 缺少选中状态的视觉反馈** — 添加 GSAP 驱动的下划线滑动动画

---

## 背景

当前 RepoTabs 切换时，selected 状态可能只有颜色变化，缺少流畅的过渡动画。目标是添加一个**下划线指示器**，在 Tab 切换时平滑滑动到新位置。

---

## 技术方案

### 方案选择：下划线 vs 背景 pill

**选择：下划线（推荐）**
- 更轻量，不遮挡文字
- 符合 atmospheric 流派的极简美学
- 实现简单，性能更好

**备选：背景 pill**
- 视觉更重，适合 playful 流派
- 需要处理 border-radius 动画
- 本次不采用

---

## 实现步骤

### 1. 读取现有 RepoTabs 实现

首先需要查看 `ui/src/components/RepoTabs.tsx` 的当前实现，了解：
- Tab 的 DOM 结构
- selected 状态如何传递
- 是否已有 ref 引用

### 2. 添加下划线指示器

在 RepoTabs 组件中：

#### 2.1 添加 ref 和 state

```tsx
import { useRef, useEffect } from 'react'
import { gsap, motionSafe, useGSAP } from '../lib/motion'

export function RepoTabs({ tabs, selected, onSelect, trailing }) {
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])
  const indicatorRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  // ... 现有逻辑 ...
}
```

#### 2.2 添加下划线 DOM

在返回的 JSX 中，Tab 容器下方添加指示器：

```tsx
return (
  <div className="..." ref={containerRef} style={{ position: 'relative', ... }}>
    {/* 现有 Tabs */}
    {tabs.map((tab, idx) => (
      <button
        key={tab.repo}
        ref={(el) => (tabsRef.current[idx] = el)}
        onClick={() => onSelect(tab.repo)}
        className="..."
        style={{
          color: tab.repo === selected ? 'var(--color-ink)' : 'var(--color-muted)',
          ...
        }}
      >
        {tab.label} {tab.count > 0 && `(${tab.count})`}
      </button>
    ))}
    
    {/* 新增：下划线指示器 */}
    <div
      ref={indicatorRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: 2,
        background: 'var(--color-accent)',
        pointerEvents: 'none',
        willChange: 'transform, width',
      }}
    />
    
    {trailing && <div className="...">{trailing}</div>}
  </div>
)
```

#### 2.3 添加 GSAP 动画

使用 `useGSAP` 监听 `selected` 变化：

```tsx
useGSAP(
  () => {
    const selectedIdx = tabs.findIndex((t) => t.repo === selected)
    if (selectedIdx === -1) return
    
    const targetTab = tabsRef.current[selectedIdx]
    const indicator = indicatorRef.current
    if (!targetTab || !indicator) return
    
    const { offsetLeft, offsetWidth } = targetTab
    
    motionSafe(
      () => {
        gsap.to(indicator, {
          x: offsetLeft,
          width: offsetWidth,
          duration: 0.3,
          ease: 'token-ease-out',
        })
      },
      () => {
        // prefers-reduced-motion: 立即跳转
        gsap.set(indicator, { x: offsetLeft, width: offsetWidth })
      },
    )
  },
  { scope: containerRef, dependencies: [selected, tabs] },
)
```

**关键点：**
- 监听 `selected` 和 `tabs`（tabs 变化时 count 可能导致 width 变化）
- 使用 `x` 和 `width` 同时动画（而非 `left` + `width`，transform 性能更好）
- `willChange: 'transform, width'` 提示浏览器优化
- `duration: 0.3` + `token-ease-out` 符合微交互标准

---

## 验收标准

### 1. 视觉验证（Chrome DevTools MCP）

启动 `npm run dev`，用 Chrome DevTools MCP 截图 + 录屏：

**检查点 1：初始状态**
- [ ] 下划线位于当前选中 Tab 下方
- [ ] 宽度与 Tab 文字宽度一致
- [ ] 颜色为 `--color-accent`（蓝色）

**检查点 2：切换动画**
- [ ] 点击其他 Tab，下划线平滑滑动到新位置
- [ ] 宽度同步变化（如果新 Tab 文字更长/更短）
- [ ] 动画时长约 300ms，ease-out 曲线

**检查点 3：响应式**
- [ ] 768px / 375px 宽度下，下划线仍然对齐正确
- [ ] Tab 换行时（如果会换行），下划线跟随

### 2. 功能验证

- [ ] 切换 Tab 后，TaskGrid 正确过滤任务
- [ ] "全部"Tab 和具体 repo Tab 切换正常
- [ ] trailing 的"清理已结束"按钮不受影响
- [ ] prefers-reduced-motion 下，下划线瞬移而非滑动

### 3. 测试验证

```bash
npm run lint          # 无错误
npm run test:all      # 全部通过
npm run build         # 构建成功
```

---

## 技术细节

### 为什么用 transform + width 而非 left + width

**❌ 不推荐（触发 layout）：**
```tsx
gsap.to(indicator, {
  left: offsetLeft,   // 触发 layout
  width: offsetWidth,
  duration: 0.3,
})
```

**✅ 推荐（GPU 加速）：**
```tsx
gsap.to(indicator, {
  x: offsetLeft,      // transform: translateX，GPU 加速
  width: offsetWidth,  // width 仍然触发 layout，但只有一个属性
  duration: 0.3,
})
```

**最优方案（如果 width 也要避免 layout）：**
```tsx
// 方案：用 scaleX 替代 width
gsap.to(indicator, {
  x: offsetLeft + offsetWidth / 2,  // 中心点对齐
  scaleX: offsetWidth / baseWidth,   // 缩放到目标宽度
  transformOrigin: '50% 50%',
  duration: 0.3,
})
```

但 `scaleX` 需要预设 `baseWidth`，实现稍复杂。本次先用 `x + width`，性能已足够（只有一个元素动画）。

### willChange 的使用

```css
willChange: 'transform, width'
```

**作用：**
- 提示浏览器为这两个属性创建合成层
- 减少 repaint/reflow

**注意：**
- 只在动画元素上使用
- 不要滥用（过多 willChange 反而降低性能）

---

## Edge Cases 处理

### 1. 初次渲染

初次渲染时，`selectedIdx` 可能在 `useGSAP` 执行前还未确定。需要在 `useEffect` 中初始化：

```tsx
useEffect(() => {
  const selectedIdx = tabs.findIndex((t) => t.repo === selected)
  if (selectedIdx === -1) return
  
  const targetTab = tabsRef.current[selectedIdx]
  const indicator = indicatorRef.current
  if (!targetTab || !indicator) return
  
  // 初次渲染：立即设置位置，不动画
  gsap.set(indicator, {
    x: targetTab.offsetLeft,
    width: targetTab.offsetWidth,
  })
}, []) // 空 deps，只在 mount 时执行一次
```

### 2. Tabs 数组变化

如果 `tabs` 数组内容变化（比如某个 repo 的任务数变化导致 label 变化），需要重新计算 `offsetWidth`。

已在 `useGSAP` 的 `dependencies: [selected, tabs]` 中处理。

### 3. 容器宽度变化

如果窗口 resize，Tab 的 `offsetLeft` 和 `offsetWidth` 可能变化。可以添加 `ResizeObserver`：

```tsx
useEffect(() => {
  const container = containerRef.current
  if (!container) return
  
  const observer = new ResizeObserver(() => {
    // 触发 useGSAP 重新计算
    // 方法：强制更新或添加 resize flag
  })
  
  observer.observe(container)
  return () => observer.disconnect()
}, [])
```

**本次先不实现**（resize 场景较少，可以后续优化）。

---

## 注意事项

1. **不修改 Tab 点击逻辑** — 只添加视觉指示器，`onSelect` 回调保持不变
2. **indicator 在 Tab 容器内** — 使用 `position: absolute`，相对于容器定位
3. **aria-hidden="true"** — 下划线纯视觉装饰，不参与无障碍树
4. **测试 trailing 元素** — 确认"清理已结束"按钮不被 indicator 遮挡

---

## 回退方案

如果下划线动画不协调：
- **方案 1**：减小 duration（0.3s → 0.2s）
- **方案 2**：改用 `ease: 'power2.inOut'` 而非 `token-ease-out`
- **方案 3**：取消 width 动画，只动画 x（固定宽度下划线）

如果性能有问题：
- **方案 1**：用 `scaleX` 替代 `width`（避免 layout）
- **方案 2**：降低 fps（`gsap.ticker.fps(30)`）
- **方案 3**：回退到纯 CSS transition

---

**任务输出：**
- 修改后的 `RepoTabs.tsx`
- Chrome DevTools MCP 截图（Tab 切换前后 + 动画中间帧）
- 回执文档

---

**PM 签字：** Claude (Fable 5) — 2026-07-04 05:30
