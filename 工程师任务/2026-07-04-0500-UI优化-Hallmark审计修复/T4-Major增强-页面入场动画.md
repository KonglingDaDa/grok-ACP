# Task 4: Major 增强 — 页面级入场动画

**任务编号：** T4  
**优先级：** P1  
**预计耗时：** 12 分钟  
**超时：** 15 分钟  
**依赖：** T1 完成

---

## 目标

修复 Hallmark 审计的 1 个 Major 问题：

**缺少页面级入场动画** — 添加 TaskGrid 卡片 stagger 入场 + TopBar/StatusBar 滑入动画

---

## 背景

当前监控 UI 刷新时，所有元素静态挂载，显得生硬。目标是添加"页面绘制"效果：
- TopBar 从顶部滑入
- 卡片依次淡入（stagger）
- StatusBar 从底部滑入

---

## 技术方案

### 动画预算

根据 Hallmark microinteractions 规则：
- 每个页面最多 3-5 个动效点
- 首屏加载动效总时长 ≤ 1.2s

**本次添加：**
1. TopBar 滑入（150ms，无延迟）
2. 卡片 stagger 入场（每张 80ms stagger，约 400ms 总计）
3. StatusBar 滑入（150ms，400ms 延迟）

**总时长：** ~550ms（符合预算）

---

## 实现步骤

### 1. TopBar 入场动画（`ui/src/components/TopBar.tsx`）

添加 `useGSAP` hook，在 mount 时从顶部滑入：

```tsx
import { useRef } from 'react'
import { gsap, motionSafe, useGSAP } from '../lib/motion'

export function TopBar({ runningCount, todayCount, connection, demo }: TopBarProps) {
  const headerRef = useRef<HTMLElement>(null)
  
  useGSAP(
    () => {
      motionSafe(
        () => {
          gsap.from(headerRef.current, {
            y: -44,
            autoAlpha: 0,
            duration: 0.15,
            ease: 'token-ease-out',
          })
        },
        () => {
          // prefers-reduced-motion: 立即显示
          gsap.from(headerRef.current, {
            autoAlpha: 0,
            duration: 0.1,
          })
        },
      )
    },
    { scope: headerRef },
  )
  
  const live = connection === 'live'
  return (
    <header ref={headerRef} className="..." style={{ ... }}>
      {/* 现有内容 */}
    </header>
  )
}
```

**关键点：**
- `y: -44` 是 TopBar 的高度，从屏幕上方滑入
- `autoAlpha: 0` 同时处理 opacity 和 visibility
- 短 duration（150ms），避免阻塞主内容

---

### 2. TaskGrid 卡片 stagger 入场（`ui/src/components/TaskGrid.tsx`）

需要先读取 TaskGrid 的实现，了解：
- 卡片如何渲染（map over grid.running + grid.compact）
- 是否已有 ref 引用

**预期修改：**

```tsx
import { useRef } from 'react'
import { gsap, motionSafe, useGSAP } from '../lib/motion'

export function TaskGrid({ grid, samples, demo, onOpen, ensureSamples, removeTask, markRemoving, clearRemoving }) {
  const gridRef = useRef<HTMLDivElement>(null)
  
  useGSAP(
    () => {
      const cards = gridRef.current?.querySelectorAll('[data-card-id]')
      if (!cards || cards.length === 0) return
      
      motionSafe(
        () => {
          gsap.from(cards, {
            autoAlpha: 0,
            y: 8,
            duration: 0.3,
            stagger: 0.08,
            ease: 'token-ease-out',
          })
        },
        () => {
          // prefers-reduced-motion: 快速淡入，无 stagger
          gsap.from(cards, {
            autoAlpha: 0,
            duration: 0.15,
          })
        },
      )
    },
    { scope: gridRef, dependencies: [grid] },  // grid 变化时重新触发（可选）
  )
  
  return (
    <div ref={gridRef} className="...">
      {/* 现有卡片渲染 */}
    </div>
  )
}
```

**关键点：**
- `querySelectorAll('[data-card-id]')` 选取所有卡片（Running + Compact）
- `stagger: 0.08` 每张卡片延迟 80ms，5 张卡片总计 400ms
- `y: 8` 轻微向下位移，配合 opacity 形成"浮现"感
- `dependencies: [grid]` — **可选**，如果想在 grid 变化时重新触发（比如切换 Tab），加上；否则只在 mount 时触发一次

**注意：** 如果 `dependencies: [grid]`，每次 Tab 切换都会触发动画，可能过于频繁。建议只在首次 mount 时触发，去掉 dependencies。

---

### 3. StatusBar 入场动画（`ui/src/components/StatusBar.tsx`）

类似 TopBar，从底部滑入，但添加延迟：

```tsx
import { useRef } from 'react'
import { gsap, motionSafe, useGSAP } from '../lib/motion'

export function StatusBar({ runningCount, todayCount }: StatusBarProps) {
  const footerRef = useRef<HTMLElement>(null)
  
  useGSAP(
    () => {
      motionSafe(
        () => {
          gsap.from(footerRef.current, {
            y: 36,
            autoAlpha: 0,
            duration: 0.15,
            delay: 0.4,  // 等卡片 stagger 完成
            ease: 'token-ease-out',
          })
        },
        () => {
          // prefers-reduced-motion: 立即显示，无延迟
          gsap.from(footerRef.current, {
            autoAlpha: 0,
            duration: 0.1,
          })
        },
      )
    },
    { scope: footerRef },
  )
  
  return (
    <footer ref={footerRef} className="..." style={{ ... }}>
      {/* 现有内容 */}
    </footer>
  )
}
```

**关键点：**
- `y: 36` 是 StatusBar 的高度，从屏幕下方滑入
- `delay: 0.4` 等待卡片 stagger 基本完成（5 张卡片 × 0.08 = 0.4s）
- 最后出现，形成"收尾"效果

---

## 时序图

```
0ms    ┌─ TopBar starts (y: -44 → 0)
       │
150ms  └─ TopBar ends
       
       ┌─ Cards start (stagger 0.08)
       │  Card 1: 0ms
       │  Card 2: 80ms
       │  Card 3: 160ms
       │  Card 4: 240ms
       │  Card 5: 320ms
       │
400ms  ├─ StatusBar starts (delay 0.4, y: 36 → 0)
       │  (Last card still animating)
       │
550ms  └─ StatusBar ends (all done)
```

**总时长：** 550ms，符合 ≤ 1.2s 预算

---

## 验收标准

### 1. 视觉验证（Chrome DevTools MCP）

启动 `npm run dev`，刷新页面，用 Chrome DevTools MCP 录屏验证：

**检查点 1：TopBar**
- [ ] 从顶部滑入（不是突然出现）
- [ ] 最先出现（0ms 启动）

**检查点 2：卡片 stagger**
- [ ] 卡片依次淡入，从左到右、从上到下
- [ ] 每张卡片间隔约 80ms
- [ ] 有轻微向上浮动（y: 8 → 0）

**检查点 3：StatusBar**
- [ ] 从底部滑入（不是突然出现）
- [ ] 最后出现（约 400ms 后）

**检查点 4：prefers-reduced-motion**
- [ ] 系统设置 reduced-motion 后，所有元素快速淡入（无位移、无 stagger）

### 2. 功能验证

- [ ] 动画不阻塞交互（动画进行时可以点击卡片）
- [ ] SSE 更新不触发重复动画
- [ ] Tab 切换不触发重复动画（如果 dependencies 去掉了 grid）
- [ ] 空状态（无卡片）时不报错

### 3. 性能验证

Chrome DevTools Performance 录制：
- [ ] 页面加载到 FCP（First Contentful Paint）< 500ms
- [ ] 动画期间无明显掉帧（60fps）
- [ ] GPU 合成层数量合理（< 10 个）

### 4. 测试验证

```bash
npm run lint          # 无错误
npm run test:all      # 全部通过
npm run build         # 构建成功
```

---

## 技术细节

### 为什么用 autoAlpha 而非 opacity

**`autoAlpha` = `opacity` + `visibility`**

GSAP 的 `autoAlpha: 0` 等价于：
```css
opacity: 0;
visibility: hidden;  /* 从 DOM 流中移除，不占据空间 */
```

**好处：**
- 动画开始前，元素不可见且不占空间
- 动画结束后，自动设置 `visibility: visible`
- 避免 FOUC（Flash of Unstyled Content）

### 为什么 TopBar/StatusBar 不用 stagger

**Stagger 适用场景：**
- 多个同类元素（卡片、列表项、图标）
- 需要形成"依次出现"的视觉节奏

**TopBar/StatusBar 是单一元素：**
- 各自只有一个 header/footer
- 用 stagger 没有意义（只有一个目标）
- 用简单的 `gsap.from` 足够

### 为什么 StatusBar 延迟 0.4s

**视觉层次：**
1. 框架先出现（TopBar）
2. 内容依次绘制（卡片 stagger）
3. 框架收尾（StatusBar）

**延迟计算：**
- 5 张卡片 × 0.08s stagger = 0.4s
- StatusBar 在 0.4s 开始，此时最后一张卡片刚开始动画
- 0.4s + 0.15s = 0.55s 总结束，整体协调

---

## Edge Cases 处理

### 1. 无卡片时

TaskGrid 的 `cards.length === 0` 时，`gsap.from` 不执行，不会报错。

但最好显式检查：
```tsx
if (!cards || cards.length === 0) return
```

### 2. 卡片动态添加

如果 SSE 推送新任务，卡片动态添加到 grid：
- **不触发动画**（只在 mount 时触发）
- **原因：** `dependencies` 不包含 `grid`，只在首次渲染时执行

如果想让新卡片也有动画：
```tsx
useGSAP(
  () => {
    const cards = gridRef.current?.querySelectorAll('[data-card-id]')
    if (!cards || cards.length === 0) return
    
    // 只对新卡片动画（需要标记哪些是新的）
    // 复杂度较高，本次不实现
  },
  { scope: gridRef, dependencies: [grid.running.length, grid.compact.length] },
)
```

### 3. 页面刷新 vs 首次加载

目前实现在每次组件 mount 时触发，包括：
- 首次打开页面
- 刷新页面（F5）
- 切换路由后返回（如果是 SPA）

**当前监控 UI 是单页应用**，没有路由，所以只在首次加载和刷新时触发，符合预期。

---

## 注意事项

1. **不修改卡片删除动画** — 现有的 `fadeOutAndRemoveTask` 保持不变
2. **不影响 DetailPanel** — modal 打开动画（T2）独立，不冲突
3. **TopBar/StatusBar 的 ref** — 确认现有代码没有使用 `headerRef`/`footerRef`，避免冲突
4. **测试空状态** — 访问 `http://localhost:5173` 无数据时，确认不报错

---

## 回退方案

如果动画过于"重"：
- **方案 1**：减小 y 位移（8px → 4px）
- **方案 2**：减少 stagger 延迟（0.08s → 0.05s）
- **方案 3**：去掉 TopBar/StatusBar 的 y 位移，只保留 opacity

如果性能有问题：
- **方案 1**：减少 stagger 数量（只动画前 10 张卡片）
- **方案 2**：降低 duration（0.3s → 0.2s）
- **方案 3**：完全禁用入场动画（只在 motion-safe 时触发）

---

**任务输出：**
- 修改后的 3 个文件（`TopBar.tsx`, `TaskGrid.tsx`, `StatusBar.tsx`）
- Chrome DevTools MCP 录屏（页面刷新动画序列）
- Performance 截图（FCP + GPU 层数）
- 回执文档

---

**PM 签字：** Claude (Fable 5) — 2026-07-04 05:35
