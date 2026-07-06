# Task 1: Critical 修复 — Chroma + 字体配对 + Nav/Footer 升级

**任务编号：** T1  
**优先级：** P0  
**预计耗时：** 15 分钟  
**超时：** 20 分钟  
**依赖：** 无

---

## 目标

修复 Hallmark 审计的 3 个 Critical 问题：

1. **零 chroma 中性色** — 提升所有中性色的 chroma 值（0.004–0.012 → 0.018–0.025）
2. **单字体页面** — 引入 display 字体配对（Inter Tight + JetBrains Mono）
3. **N9+Ft2 过于安静** — 升级为 N6 (Split-level command bar) + Ft6 (Stat bar)

---

## 修改清单

### 1. 提升中性色 chroma（`ui/src/styles/tokens.css`）

**当前值（有问题）：**
```css
--color-paper:    oklch(15% 0.006 260);  /* chroma 太低 */
--color-paper-2:  oklch(24% 0.008 260);
--color-paper-3:  oklch(30% 0.010 260);
--color-rule:     oklch(36% 0.010 260);
--color-rule-2:   oklch(48% 0.012 260);
--color-muted:    oklch(64% 0.012 260);
--color-neutral:  oklch(75% 0.010 260);
--color-ink-2:    oklch(86% 0.006 260);
--color-ink:      oklch(94% 0.004 260);
```

**目标值（修复后）：**
```css
--color-paper:    oklch(15% 0.018 260);  /* 提升至 0.018 */
--color-paper-2:  oklch(24% 0.020 260);  /* 提升至 0.020 */
--color-paper-3:  oklch(30% 0.022 260);  /* 提升至 0.022 */
--color-rule:     oklch(36% 0.020 260);  /* 提升至 0.020 */
--color-rule-2:   oklch(48% 0.023 260);  /* 提升至 0.023 */
--color-muted:    oklch(64% 0.023 260);  /* 提升至 0.023 */
--color-neutral:  oklch(75% 0.021 260);  /* 提升至 0.021 */
--color-ink-2:    oklch(86% 0.018 260);  /* 提升至 0.018 */
--color-ink:      oklch(94% 0.015 260);  /* 提升至 0.015 */
```

**修改原因：**
- 深色模式下，chroma < 0.015 的中性色显得过于平坦、缺乏温度
- 提升至 0.018–0.025 范围后，保持冷蓝（260°）锚定，但增强立体感
- Hue 保持 260°不变（已经是正确的冷蓝）

---

### 2. 引入 display 字体配对（`ui/src/styles/tokens.css` + 安装字体）

#### 2.1 安装 Inter Tight

```bash
cd ui
npm install @fontsource-variable/inter-tight
```

#### 2.2 修改 `tokens.css`

**添加字体 token（第 28 行附近）：**
```css
/* type — display + body pairing */
--font-display: "Inter Tight Variable", ui-sans-serif, system-ui, sans-serif;
--font-body: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
--font-mono: var(--font-body);  /* alias for backward compat */
```

**保持现有 text-size / tracking / lh 不变。**

#### 2.3 修改 `ui/src/styles/index.css`

**添加 Inter Tight 导入（第 4 行后）：**
```css
@import "tailwindcss";
@import "./tokens.css";

/* self-hosted fonts */
@import "@fontsource-variable/inter-tight";  /* 新增 */
@import "@fontsource/jetbrains-mono/400.css";
@import "@fontsource/jetbrains-mono/500.css";
@import "@fontsource/jetbrains-mono/700.css";
```

**修改 body 默认字体（第 69 行）：**
```css
body {
  margin: 0;
  font-family: var(--font-body);  /* 保持 mono 作为 body 默认 */
  font-size: var(--text-base);
  /* ... */
}
```

#### 2.4 应用 display 字体到组件

**修改以下文件，为标题/标签添加 `font-family: var(--font-display)`：**

**`ui/src/components/TopBar.tsx`（第 23-28 行）：**
```tsx
<div className="flex items-center gap-xs" style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
  <span>GROK ACP</span>
  <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>▮</span>
  <span style={{ color: 'var(--color-neutral)', fontWeight: 500 }}>监控</span>
  {/* ... */}
</div>
```

**`ui/src/components/TaskCard.tsx`（第 253 行附近，卡片标题）：**
```tsx
<h3 className="truncate text-base" style={{ color: 'var(--color-ink-2)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
  {task.name}
</h3>
```

**`ui/src/components/DetailPanel.tsx`（第 160 行附近，面板标题）：**
```tsx
<span className="truncate text-lg" style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
  {activeTask.name}
</span>
```

**`ui/src/components/TaskCard.tsx`（第 163 行附近，状态标签）：**
```tsx
<span className="mono-label text-xs" style={{ color: ledColor(status), fontFamily: 'var(--font-display)', fontWeight: 600 }}>
  {STATUS_WORD[status]}
</span>
```

**保持以下元素使用 mono（不修改）：**
- 数值（tokens、耗时、吞吐量）
- 路径（targetCwd、invokerCwd）
- 时间戳
- Prompt 代码块
- OutputStream

---

### 3. 升级 Nav + Footer（N9 → N6, Ft2 → Ft6）

#### 3.1 TopBar 改造为 N6 (Split-level command bar)

**当前问题：**
- 左右两侧都是文字，缺少视觉分组
- "运行中"和"今日"指标混在右侧，不够突出

**目标设计（N6）：**
```
┌─────────────────────────────────────────────────────────────┐
│ [GROK ACP ▮ 监控]    [● 2 运行中]    [在线 · 今日 8]        │
│  (左：品牌)           (中：主指标)    (右：次要指标)         │
└─────────────────────────────────────────────────────────────┘
```

**修改 `ui/src/components/TopBar.tsx`：**

```tsx
export function TopBar({ runningCount, todayCount, connection, demo }: TopBarProps) {
  const live = connection === 'live'
  return (
    <header
      className="mono-label sticky top-0 flex items-center justify-between gap-md px-md text-xs"
      style={{
        height: 44,
        borderBottom: '1px solid var(--color-rule)',
        background: 'var(--color-paper)',
        zIndex: 'var(--z-sticky-nav)',
      }}
    >
      {/* 左：品牌 */}
      <div className="flex items-center gap-xs" style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
        <span>GROK ACP</span>
        <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>▮</span>
        <span style={{ color: 'var(--color-neutral)', fontWeight: 500 }}>监控</span>
        {demo && (
          <span
            className="ml-sm px-xs text-xs"
            style={{
              border: '1px solid var(--color-warn)',
              borderRadius: 'var(--radius-pill)',
              color: 'var(--color-warn)',
            }}
          >
            演示数据
          </span>
        )}
      </div>

      {/* 中：主指标（运行中任务） */}
      <div
        className="flex items-center gap-2xs"
        style={{
          color: runningCount > 0 ? 'var(--color-up)' : 'var(--color-muted)',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 'var(--text-sm)',
        }}
      >
        <span aria-hidden="true" className={runningCount > 0 ? 'led-running' : ''}>●</span>
        <span>{runningCount} 运行中</span>
      </div>

      {/* 右：次要指标 */}
      <div className="flex items-center gap-md">
        <span
          className="flex items-center gap-2xs"
          style={{ color: live ? 'var(--color-up)' : 'var(--color-warn)' }}
          title={live ? '已连接' : '重连中'}
        >
          <span aria-hidden="true" className={live ? '' : 'led-running'}>●</span>
          {live ? '在线' : '重连中'}
        </span>
        <span style={{ color: 'var(--color-muted)' }}>今日 {todayCount}</span>
      </div>
    </header>
  )
}
```

**关键改动：**
- 左中右三分，视觉分组更清晰
- "运行中"移到中央，放大（text-sm），加粗（font-display + weight 600）
- "在线"和"今日"合并到右侧

#### 3.2 StatusBar 改造为 Ft6 (Stat bar)

**当前问题：**
- 只显示静态信息（数据目录、保留天数、版本号）
- 缺少实时统计

**目标设计（Ft6）：**
```
┌─────────────────────────────────────────────────────────────┐
│ ~/.grok-acp · 保留 7 天          2 运行 · 8 今日 · v0.2.0  │
│ (左：数据源信息)                  (右：实时统计 + 版本)      │
└─────────────────────────────────────────────────────────────┘
```

**修改 `ui/src/components/StatusBar.tsx`：**

```tsx
const VERSION = '0.2.0'

export interface StatusBarProps {
  runningCount: number
  todayCount: number
}

/** Footer prototype Ft6 — stat bar with live metrics (§4.3.4). */
export function StatusBar({ runningCount, todayCount }: StatusBarProps) {
  return (
    <footer
      className="mono-label flex items-center justify-between px-md text-xs"
      style={{
        height: 36,
        borderTop: '1px solid var(--color-rule)',
        color: 'var(--color-muted)',
        background: 'var(--color-paper)',
      }}
    >
      {/* 左：数据源信息 */}
      <div className="flex items-center gap-xs">
        <span>~/.grok-acp</span>
        <span aria-hidden="true">·</span>
        <span>保留 7 天</span>
      </div>

      {/* 右：实时统计 */}
      <div className="flex items-center gap-xs">
        <span style={{ color: runningCount > 0 ? 'var(--color-up)' : 'var(--color-muted)' }}>
          {runningCount} 运行
        </span>
        <span aria-hidden="true">·</span>
        <span>{todayCount} 今日</span>
        <span aria-hidden="true">·</span>
        <span>v{VERSION}</span>
      </div>
    </footer>
  )
}
```

**修改 `ui/src/App.tsx`（第 117 行附近）：**
```tsx
<StatusBar runningCount={runningCount} todayCount={todayCount} />
```

---

## 验收标准

### 1. 视觉验证（Chrome DevTools MCP）

启动 `npm run dev`，用 Chrome DevTools MCP 截图对比：

**检查点 1：中性色温度**
- [ ] 背景、卡片、边框不再显得"死灰"
- [ ] 保持冷蓝（260°）色调，但有微妙的色彩倾向

**检查点 2：字体层级**
- [ ] TopBar 品牌、卡片标题、面板标题使用 Inter Tight（condensed sans）
- [ ] 数值、路径、时间戳仍然是 JetBrains Mono
- [ ] 字体对比清晰，不再是"全是 mono"

**检查点 3：Nav/Footer 信息密度**
- [ ] TopBar 中央"运行中"指标视觉突出
- [ ] StatusBar 右侧显示实时统计（运行数、今日数）
- [ ] 左右分组清晰

### 2. 功能验证

- [ ] 所有现有功能正常（卡片点击、删除、Tab 切换、SSE 更新）
- [ ] 字体加载成功（检查 Network 面板，Inter Tight variable 有 200 响应）
- [ ] 响应式布局不破坏（测试 768px / 375px 宽度）

### 3. 测试验证

```bash
npm run lint          # 无错误
npm run test:all      # 全部通过
npm run build         # 构建成功
```

### 4. Stamp 更新

修改 `ui/src/styles/tokens.css` 第一行：

**旧 stamp：**
```css
/* Hallmark · genre: atmospheric · macrostructure: Bento Grid (live dashboard adaptation) · theme: Graphite (custom neutral dark, user-directed v2) · enrichment: none · nav: N9 · footer: Ft2 */
```

**新 stamp：**
```css
/* Hallmark · genre: atmospheric · macrostructure: Bento Grid (live dashboard adaptation) · theme: Graphite (custom neutral dark, v3: chroma boosted 0.018–0.025) · enrichment: none · nav: N6 · footer: Ft6 · display: Inter Tight Variable + JetBrains Mono */
```

---

## 回退方案

如果 Inter Tight Variable 安装失败：

**回退 1：** 使用 Inter Variable（`@fontsource-variable/inter`）
**回退 2：** 使用 DM Sans（`@fontsource/dm-sans/500.css` + `/700.css`）
**回退 3：** 使用系统 sans（`ui-sans-serif, system-ui`）

修改 `--font-display` 的 fallback chain 即可，组件不需要改动。

---

## 注意事项

1. **不要修改 GSAP 动效** — 本任务只改 tokens 和静态样式，动效留给 T2-T5
2. **保持现有组件逻辑** — 只改 style 属性和 className，不改 state/props/hooks
3. **Inter Tight Variable 是 variable font** — 只需导入一次，支持 300-900 weight range
4. **测试 demo 模式** — `http://localhost:5173?demo` 确认"演示数据"标签正常

---

**任务输出：**
- 修改后的代码文件（6 个文件）
- Chrome DevTools MCP 截图（修改前 1 张 + 修改后 1 张）
- 测试通过的输出日志
- 回执文档（说明实际修改内容、遇到的问题、验收结果）

---

**PM 签字：** Claude (Fable 5) — 2026-07-04 05:20
