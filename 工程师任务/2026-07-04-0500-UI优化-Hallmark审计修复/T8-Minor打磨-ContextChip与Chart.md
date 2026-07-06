# Task 8: Minor 打磨 — ContextChip 与 ThroughputChart 优化

**任务编号：** T8  
**优先级：** P2（Minor）  
**预计耗时：** 8 分钟  
**超时：** 12 分钟  
**依赖：** T1-T5 完成

---

## 目标

修复 Hallmark 审计的最后 2 个 Minor 问题：

1. **ContextChip 缺少状态映射的颜色梯度** — 为每个 level 分配独立背景色
2. **ThroughputChart 缺少 tooltip hover 交互** — 添加 GSAP 驱动的 tooltip 显示精确数值

---

## 修改清单

### 1. ContextChip 颜色梯度（`ui/src/components/ContextChip.tsx`）

**当前问题：**
需要先读取 ContextChip 的实现，了解：
- 是否已有 level → color 的映射
- 当前是否只显示文字，没有背景色

**预期改进：**

为每个 context level 分配颜色：

```tsx
import type { TaskContext } from '../lib/types'

export interface ContextChipProps {
  context: TaskContext
}

function getContextStyle(level: string) {
  switch (level) {
    case 'ok':
      return {
        background: 'var(--color-up-tint)',  // oklch(72% 0.170 150 / 0.07)
        border: '1px solid var(--color-up-tint-border)',  // oklch(72% 0.170 150 / 0.22)
        color: 'var(--color-up)',
      }
    case 'watch':
      return {
        background: 'oklch(77% 0.140 85 / 0.07)',  // warn 7% 透明
        border: '1px solid oklch(77% 0.140 85 / 0.22)',
        color: 'var(--color-warn)',
      }
    case 'medium':
      return {
        background: 'oklch(77% 0.140 85 / 0.12)',  // warn 12% 透明
        border: '1px solid oklch(77% 0.140 85 / 0.30)',
        color: 'var(--color-warn)',
      }
    case 'high':
      return {
        background: 'oklch(65% 0.190 25 / 0.12)',  // down 12% 透明
        border: '1px solid oklch(65% 0.190 25 / 0.30)',
        color: 'var(--color-down)',
      }
    case 'critical':
      return {
        background: 'oklch(58% 0.210 25 / 0.15)',  // crit 15% 透明
        border: '1px solid var(--color-crit)',
        color: 'var(--color-crit)',
      }
    default:
      return {
        background: 'transparent',
        border: '1px solid var(--color-rule-2)',
        color: 'var(--color-muted)',
      }
  }
}

export function ContextChip({ context }: ContextChipProps) {
  const level = context?.level || 'ok'
  const style = getContextStyle(level)
  
  return (
    <div
      className="mono-label inline-flex items-center gap-2xs px-xs py-2xs text-xs"
      style={{
        ...style,
        borderRadius: 'var(--radius-pill)',
      }}
    >
      <span>上下文: {level.toUpperCase()}</span>
      {context?.totalTokens != null && (
        <span style={{ color: 'var(--color-muted)' }}>
          {formatCount(context.totalTokens)} tokens
        </span>
      )}
    </div>
  )
}
```

**改动原因：**
- 视觉上形成"警报梯度"：ok（绿）→ watch（黄浅）→ medium（黄深）→ high（红浅）→ critical（红深）
- 半透明背景 + 同色边框，保持轻量但可辨识
- 用户一眼就能看出上下文状态的严重程度

---

### 2. ThroughputChart tooltip（`ui/src/components/ThroughputChart.tsx`）

**当前问题：**
需要先读取 ThroughputChart 的实现，了解：
- 是否是 SVG sparkline
- 是否已有 hover 交互

**预期改进：**

添加 GSAP 驱动的 tooltip，hover 时显示时间戳 + 精确吞吐量：

```tsx
import { useRef, useState } from 'react'
import { gsap, motionSafe, useGSAP } from '../lib/motion'
import { formatTps } from '../lib/format'

export function ThroughputChart({ samples }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; tps: number; time: string } | null>(null)
  
  // ... 现有 SVG 绘制逻辑 ...
  
  function handlePointHover(e: MouseEvent, point: { x: number; y: number; tps: number; time: string }) {
    setHoveredPoint(point)
    
    const tooltip = tooltipRef.current
    if (!tooltip) return
    
    motionSafe(
      () => {
        gsap.to(tooltip, {
          autoAlpha: 1,
          x: point.x,
          y: point.y - 30,  // 在点上方 30px
          duration: 0.15,
          ease: 'token-ease-out',
        })
      },
      () => {
        gsap.set(tooltip, { autoAlpha: 1, x: point.x, y: point.y - 30 })
      },
    )
  }
  
  function handleMouseLeave() {
    setHoveredPoint(null)
    
    const tooltip = tooltipRef.current
    if (!tooltip) return
    
    motionSafe(
      () => {
        gsap.to(tooltip, {
          autoAlpha: 0,
          duration: 0.1,
          ease: 'token-ease-out',
        })
      },
      () => {
        gsap.set(tooltip, { autoAlpha: 0 })
      },
    )
  }
  
  return (
    <div className="relative">
      <svg ref={svgRef} onMouseLeave={handleMouseLeave}>
        {/* 现有 path / circle ... */}
        {/* 为每个数据点添加 invisible circle，捕获 hover */}
        {samples.map((sample, idx) => (
          <circle
            key={idx}
            cx={sample.x}
            cy={sample.y}
            r={8}  // 比显示的点大，更易 hover
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onMouseEnter={(e) => handlePointHover(e, {
              x: sample.x,
              y: sample.y,
              tps: sample.tps,
              time: formatTime(sample.timestamp),
            })}
          />
        ))}
      </svg>
      
      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute text-xs"
        style={{
          opacity: 0,
          visibility: 'hidden',
          background: 'var(--color-paper-3)',
          border: '1px solid var(--color-rule)',
          borderRadius: 'var(--radius-card)',
          padding: 'var(--space-2xs) var(--space-xs)',
          color: 'var(--color-ink)',
          whiteSpace: 'nowrap',
          zIndex: 'var(--z-tooltip)',
        }}
      >
        {hoveredPoint && (
          <>
            <div>{hoveredPoint.time}</div>
            <div style={{ color: 'var(--color-up)', fontWeight: 600 }}>
              {formatTps(hoveredPoint.tps)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

**改动原因：**
- 用户 hover 数据点时，能看到精确的时间戳和吞吐量
- GSAP 驱动，动画流畅（150ms 淡入，100ms 淡出）
- `pointer-events-none` 确保 tooltip 不阻挡鼠标
- `autoAlpha` 同时控制 opacity 和 visibility

---

## 验收标准

### 1. 视觉验证（Chrome DevTools MCP）

启动 `npm run dev`，用 Chrome DevTools MCP 截图对比：

**检查点 1：ContextChip 颜色梯度**
- [ ] 打开多个不同 context level 的任务详情
- [ ] ok（绿色背景）、watch（浅黄）、medium（深黄）、high（浅红）、critical（深红）
- [ ] 边框与背景同色系，视觉协调

**检查点 2：ThroughputChart tooltip**
- [ ] hover 图表中的数据点
- [ ] tooltip 在点上方 30px 处淡入
- [ ] 显示时间戳 + 吞吐量（绿色加粗）
- [ ] 鼠标离开图表，tooltip 淡出

### 2. 功能验证

- [ ] ContextChip 显示正确的 level 和 tokens
- [ ] ThroughputChart 数据点 hover 不影响图表绘制
- [ ] tooltip 不阻挡鼠标操作
- [ ] prefers-reduced-motion 下，tooltip 瞬显/瞬隐

### 3. 测试验证

```bash
npm run lint          # 无错误
npm run test:all      # 全部通过
npm run build         # 构建成功
```

---

## 技术细节

### ContextChip 颜色梯度的设计逻辑

**语义色映射：**

| Level | 语义 | 背景 OKLCH | 边框 OKLCH | 文字颜色 |
|-------|------|-----------|-----------|---------|
| ok | 正常 | up 7% | up 22% | `--color-up` |
| watch | 注意 | warn 7% | warn 22% | `--color-warn` |
| medium | 警告 | warn 12% | warn 30% | `--color-warn` |
| high | 危险 | down 12% | down 30% | `--color-down` |
| critical | 严重 | crit 15% | crit 100% | `--color-crit` |

**透明度递增：**
- ok/watch: 7%（subtle）
- medium/high: 12%（noticeable）
- critical: 15%（强调）

**边框递增：**
- ok/watch: 22%
- medium/high: 30%
- critical: 100%（实色边框）

### ThroughputChart tooltip 的交互设计

**Hover target 扩大：**
```tsx
<circle r={8} fill="transparent" />  // 比显示的点（r=2-3）大
```

**原因：** 精确 hover 小点很难，扩大 hit area 提升可用性。

**Tooltip 定位：**
```tsx
y: point.y - 30  // 在点上方 30px
```

**原因：** 避免遮挡数据点本身。

**Duration 选择：**
- 淡入 150ms：足够快，不阻塞信息获取
- 淡出 100ms：更快消失，减少视觉残留

---

## Edge Cases 处理

### 1. ContextChip 没有 context 数据

```tsx
const level = context?.level || 'ok'
```

如果 `context` 为 null/undefined，默认显示 'ok'。

### 2. ThroughputChart 样本数过少（< 2 个点）

如果样本数 < 2，图表可能不绘制 path（只有点）。

tooltip 仍然可以 hover 点，功能正常。

### 3. Tooltip 超出屏幕边界

当前实现没有边界检测，可能在屏幕边缘被裁剪。

**改进（可选，本次不实现）：**
```tsx
const tooltipWidth = tooltip.offsetWidth
const svgRect = svgRef.current.getBoundingClientRect()
const x = Math.min(point.x, svgRect.width - tooltipWidth)  // 限制右边界
```

---

## 注意事项

1. **ContextChip 需要 formatCount** — 确认已从 `../lib/format` 导入
2. **ThroughputChart 需要 useGSAP** — 确认已从 `../lib/motion` 导入
3. **Tooltip zIndex** — 使用 `--z-tooltip`（600），高于面板（400）
4. **测试无数据情况** — 新任务可能还没有 samples，确认不报错

---

## 回退方案

如果 ContextChip 颜色过于"吵"：
- **方案 1**：降低背景 opacity（全部减半）
- **方案 2**：只保留边框颜色，背景统一为 transparent

如果 ThroughputChart tooltip 实现复杂：
- **方案 1**：简化为纯 CSS tooltip（title 属性）
- **方案 2**：只在点击时显示，不用 hover

---

**任务输出：**
- 修改后的 2 个文件（`ContextChip.tsx`, `ThroughputChart.tsx`）
- Chrome DevTools MCP 截图（颜色梯度对比 + tooltip 交互）
- 回执文档

---

**PM 签字：** Claude (Fable 5) — 2026-07-04 05:55
