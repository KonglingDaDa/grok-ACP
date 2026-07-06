# Task 5: Major 增强 — LED 呼吸动画去同步化

**任务编号：** T5  
**优先级：** P1  
**预计耗时：** 6 分钟  
**超时：** 10 分钟  
**依赖：** T1 完成

---

## 目标

修复 Hallmark 审计的 1 个 Major 问题：

**LED 呼吸动画过于规律** — 所有 LED 同步呼吸，显得机械，需要去同步化

---

## 背景

当前 LED 呼吸动画（`ui/src/styles/index.css` 第 119-131 行）：
```css
@keyframes led-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.led-running {
  animation: led-breathe 2s ease-in-out infinite;
}
```

**问题：**
- 所有 LED（TopBar 运行中指示器、卡片状态、连接状态）同时呼吸
- 2s 周期完全同步，显得像"工厂流水线"

**目标：**
- 为每个 LED 添加随机延迟
- 或使用不规则呼吸节奏

---

## 技术方案

### 方案 A：CSS animation-delay（推荐）

为每个 LED 添加唯一的 `animation-delay`，打破同步。

**实现方式：**

#### 1. 修改 CSS（`ui/src/styles/index.css`）

保持 keyframe 不变，添加多个 variant class：

```css
@keyframes led-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.led-running {
  animation: led-breathe 2s ease-in-out infinite;
}

/* 为每个 LED 添加唯一延迟 */
.led-running[data-led-delay="1"] { animation-delay: 0s; }
.led-running[data-led-delay="2"] { animation-delay: 0.27s; }
.led-running[data-led-delay="3"] { animation-delay: 0.53s; }
.led-running[data-led-delay="4"] { animation-delay: 0.79s; }
.led-running[data-led-delay="5"] { animation-delay: 1.13s; }
.led-running[data-led-delay="6"] { animation-delay: 1.41s; }
```

**延迟值选择：**
- 使用质数或不规则间隔（0.27, 0.53, 0.79, 1.13, 1.41）
- 避免 0.5s 的倍数（会导致部分 LED 重新同步）
- 覆盖 0–2s 范围，均匀分布

#### 2. 修改组件，添加 data-led-delay

**`ui/src/components/TopBar.tsx`（第 48-50 行）：**
```tsx
<span aria-hidden="true" className={runningCount > 0 ? 'led-running' : ''} data-led-delay="1">
  ●
</span>
```

**`ui/src/components/TopBar.tsx`（第 59 行，连接状态 LED）：**
```tsx
<span aria-hidden="true" className={live ? '' : 'led-running'} data-led-delay="2">
  ●
</span>
```

**`ui/src/components/TaskCard.tsx`（第 98 行，StatusLed 组件）：**
```tsx
export function StatusLed({ status }: { status: EffectiveStatus }) {
  // 生成随机 delay（1-6）
  const delayId = Math.floor(Math.random() * 6) + 1
  
  return (
    <span
      aria-hidden="true"
      className={status === 'running' ? 'led-running' : ''}
      data-led-delay={status === 'running' ? String(delayId) : undefined}
      style={{ color: ledColor(status), fontSize: '0.7em', lineHeight: 1 }}
    >
      ●
    </span>
  )
}
```

**关键改动：**
- TopBar 的两个 LED 使用固定 delay（1 和 2）
- 卡片 LED 使用随机 delay（1-6），每张卡片不同
- 去掉 `data-led-delay` 属性时，回退到默认（无延迟）

---

### 方案 B：GSAP 驱动（备选）

用 GSAP 替代 CSS animation，实现不规则呼吸：

```tsx
useGSAP(() => {
  const leds = document.querySelectorAll('.led-running')
  leds.forEach((led, idx) => {
    gsap.to(led, {
      opacity: 0.4,
      duration: 1,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: (idx * 0.27) % 2,  // 随机延迟
    })
  })
}, [])
```

**优点：**
- 更灵活，可以实现复杂的呼吸曲线
- 可以动态调整参数

**缺点：**
- 性能略差（JS vs CSS）
- 代码复杂度更高
- prefers-reduced-motion 需要单独处理

**本次不采用**（CSS 方案足够，性能更好）

---

## 验收标准

### 1. 视觉验证（Chrome DevTools MCP）

启动 `npm run dev`，用 Chrome DevTools MCP 录屏验证：

**检查点 1：TopBar LED 不同步**
- [ ] "运行中"指示器 LED 和"重连中"LED（如果有）呼吸节奏不同
- [ ] 两者不会同时达到最暗/最亮

**检查点 2：卡片 LED 不同步**
- [ ] 多张 Running 卡片的 LED 呼吸节奏各不相同
- [ ] 刷新页面后，节奏重新随机（因为 `Math.random()`）

**检查点 3：呼吸周期保持**
- [ ] 每个 LED 的呼吸周期仍然是 2s（没有加快/减慢）
- [ ] ease-in-out 曲线保持（平滑呼吸，不是闪烁）

**检查点 4：prefers-reduced-motion**
- [ ] 系统设置 reduced-motion 后，LED 不呼吸（opacity 固定 1.0）

### 2. 功能验证

- [ ] LED 颜色正确（up=绿、warn=黄、其他=灰）
- [ ] Running 状态切换到 Done/Error 后，LED 停止呼吸
- [ ] 新卡片出现时，LED 呼吸延迟随机

### 3. 测试验证

```bash
npm run lint          # 无错误
npm run test:all      # 全部通过
npm run build         # 构建成功
```

---

## 技术细节

### 为什么用质数延迟

**0.27s, 0.53s, 0.79s, 1.13s, 1.41s** 选择依据：

**❌ 不推荐（规律延迟）：**
```css
animation-delay: 0s;    /* LED 1 */
animation-delay: 0.4s;  /* LED 2 */
animation-delay: 0.8s;  /* LED 3 */
animation-delay: 1.2s;  /* LED 4 */
animation-delay: 1.6s;  /* LED 5 */
```

**问题：** 0.4s × 5 = 2.0s，正好是一个周期，LED 会重新同步。

**✅ 推荐（不规则延迟）：**
```css
animation-delay: 0s;     /* LED 1 */
animation-delay: 0.27s;  /* LED 2: 2 × 0.27 = 0.54 ≠ 整数周期 */
animation-delay: 0.53s;  /* LED 3 */
animation-delay: 0.79s;  /* LED 4 */
animation-delay: 1.13s;  /* LED 5 */
animation-delay: 1.41s;  /* LED 6 */
```

**原理：** 延迟值不是周期的整数倍，LED 永远不会重新同步。

### 为什么用 Math.random() 而非固定

**TopBar LED（固定延迟）：**
- TopBar 只有 1-2 个 LED，位置固定
- 用固定延迟（1 和 2）即可，不需要随机

**卡片 LED（随机延迟）：**
- 卡片数量动态变化（可能有 10+ 张）
- 如果都用相同延迟，多张卡片的 LED 还是会同步
- 用 `Math.random()` 生成 1-6 的随机数，每张卡片不同

**刷新页面重新随机：**
- 每次组件 mount 时，`Math.random()` 重新计算
- 用户刷新页面后，LED 节奏会变化
- 这是合理的（呼吸节奏本就不需要持久化）

---

## Edge Cases 处理

### 1. 卡片状态切换

Running → Done 时，`.led-running` class 被移除，动画自动停止，opacity 恢复默认（由 `ledColor()` 决定）。

不需要额外处理。

### 2. 多个 Running 卡片

如果有 10 张 Running 卡片，只有 6 个 delay variant（1-6）：
- 前 6 张卡片：delay 各不相同
- 第 7-12 张卡片：delay 会重复（但概率分布随机）

**影响：** 部分卡片可能同步，但因为随机分布，大概率仍然错开。

**改进（可选）：**
```tsx
const delayId = (Math.floor(Math.random() * 10) % 6) + 1  // 扩展到 10 个 variant
```

但需要在 CSS 中添加 delay="7"-"10" 的定义。本次先用 6 个。

### 3. prefers-reduced-motion

现有 CSS 已经处理：
```css
@media (prefers-reduced-motion: reduce) {
  .led-running {
    animation: none;
    opacity: 1;
  }
}
```

添加 `data-led-delay` 后，这个规则仍然生效（属性选择器优先级低于 media query）。

---

## 注意事项

1. **不修改 keyframe** — 保持 2s 周期和 ease-in-out 曲线
2. **不影响非 LED 元素** — 只修改 `.led-running` class 的元素
3. **StatusLed 组件会多次渲染** — 每次渲染都会重新生成 `delayId`，但因为 React 的 key 稳定（task.id），DOM 不会重建，动画不会重启
4. **测试连接状态** — 断开网络时，"重连中"LED 应该也有随机延迟

---

## 回退方案

如果随机延迟过于"乱"：
- **方案 1**：减少 delay variant（6 → 3）
- **方案 2**：TopBar 和卡片都用固定延迟（不用 `Math.random()`）
- **方案 3**：只对卡片 LED 去同步化，TopBar LED 保持同步

如果性能有问题：
- **方案 1**：用 CSS custom property `--led-delay: random(0, 2s)`（CSS Houdini，浏览器支持有限）
- **方案 2**：回退到方案 B（GSAP 驱动），但降低 fps

---

**任务输出：**
- 修改后的 2 个文件（`index.css`, `TopBar.tsx`, `TaskCard.tsx`）
- Chrome DevTools MCP 录屏（多个 LED 呼吸对比）
- 回执文档

---

**PM 签字：** Claude (Fable 5) — 2026-07-04 05:40
