# grokACP Monitor — 设计文档（实现契约）

> 本文档是 monitor 功能的唯一事实来源。后端 agent 与前端 agent 并行开发，双方只依赖本文档中的 schema 与 API 契约，不得私自变更契约；发现契约缺陷时先停下来上报。

## 0. 目标

给 grokACP 增加一个本地实时监控面板：每当任何项目通过本调度器以 ACP 调用 Grok，面板实时出现任务卡片。按目标仓库分页；卡片显示提示词预览、上下文状态、运行/完成/中断状态（动效区分）；每个任务附一条 token 吞吐速率折线图（行情终端式起伏）；点开卡片看详情大图、完整提示词、流式正文。**纯查看，不提供任何控制操作。**

已确认的决策：
- 前端：React + Vite + Tailwind v4 + GSAP，构建产物 `ui/dist` 提交仓库
- 后端：保持零 npm 依赖（node:http + SSE + 文件事件日志）
- 数据：文件事件日志写入 `~/.grok-acp/`，保留 7 天，滚动清理
- 折线图：吞吐速率 tokens/s（1s 采样），卡片迷你图 + 详情大图
- 分页：按 Grok 执行目录 `--cwd`（目标仓库）分组，卡片标注发起方目录
- 流式正文：完整落盘、可实时跟随、可回看
- 视觉：深色交易终端风（Hallmark: atmospheric / Terminal 主题，详见 §6）

## 1. 架构总览

```
grok-acp run/compact (短命 CLI 进程)
  └─ TaskRecorder ──写──▶ ~/.grok-acp/runs/<taskId>/
                              meta.json          (状态快照，原子重写)
                              throughput.ndjson  (1s 采样追加)
                              output.md          (流式正文追加)

grok-acp ui (常驻 node:http 服务, 默认 127.0.0.1:41730)
  ├─ 静态服务 ui/dist
  ├─ GET /api/tasks · /api/tasks/:id · /api/tasks/:id/output
  ├─ GET /api/events (SSE: task / sample)
  └─ fs.watch runs/ 目录 → 推送增量；7 天滚动清理

浏览器 (ui/dist, React SPA)
  └─ EventSource + fetch → 卡片网格 / 速率图 / 详情面板
```

数据根目录：`GROK_ACP_HOME` 环境变量，默认 `~/.grok-acp`。recorder、server、fake-task 工具全部尊重该变量（集成测试用它指向 /tmp）。

## 2. 数据层 schema（契约，双方以此为准）

### 2.1 taskId 与目录

- `taskId = <nowBeijingStamp()>-<4位随机hex>`，例 `20260703154501+08-a3f9`。目录名即 taskId（注意 `+` 在 URL 中需 encodeURIComponent）。
- 目录：`$GROK_ACP_HOME/runs/<taskId>/`

### 2.2 meta.json（原子写：先写 `.tmp` 再 rename）

```json
{
  "id": "20260703154501+08-a3f9",
  "name": "fix-login-bug",
  "command": "run",
  "status": "running",
  "prompt": "完整提示词全文…",
  "promptPreview": "前 160 字符…",
  "model": "grok-composer-2.5-fast",
  "targetCwd": "/home/desk/dev/repos/zq",
  "invokerCwd": "/home/desk/dev/pm-project",
  "sessionId": "sess_abc 或 null",
  "pid": 12345,
  "startedAt": "2026-07-03T15:45:01+08:00",
  "endedAt": null,
  "heartbeatAt": "2026-07-03T15:45:11+08:00",
  "tokensOut": 1234,
  "chars": 5320,
  "durationMs": null,
  "context": null,
  "reportPath": null,
  "jsonPath": null,
  "error": null
}
```

字段说明：
- `command`: `"run" | "compact"`（`new`/`status`/`doctor` 不产生任务记录）
- `status`: `"running" | "done" | "error"`（**没有** `"interrupted"` —— 中断是 server 端根据心跳推导的 `effectiveStatus`，不落盘）
- `context`: 完成时从 `session-store.getSessionStatus({cwd, sessionId})` 填入 `{ level, totalTokens, usagePct }`（取不到则保持 null；字段名以 session-store 现有返回为准做映射）
- `heartbeatAt`: 运行期间每 ~2s 更新；`tokensOut`/`chars` 同步更新
- 时间戳一律用 `config.mjs` 的 `nowBeijingIso()`

### 2.3 throughput.ndjson（append-only，每行一个 JSON）

```json
{"t":1751527501000,"tps":42.5,"cum":1234}
```

- `t`: epoch ms；`tps`: 该 1s 桶内新增的估算 token 数；`cum`: 累计估算 token
- 运行期间每 1s 追加一行；**无新输出也追加 `tps:0`**（停顿要在图上看得见——曲线下坠正是需求要的视觉）
- 任务结束时停止采样

### 2.4 output.md（append-only）

Grok 流式回复文本按 chunk 原样追加。无包装、无转义。

### 2.5 token 估算

ACP 不回报 token 数，用字符估算（图表只需相对起伏）：

```
estimateTokens(text) = round(CJK字符数 × 1 + 其余字符数 ÷ 4)
CJK 判定: /[　-〿㐀-鿿豈-﫿＀-￯]/
```

### 2.6 7 天清理

`cleanupOldRuns(runsDir, maxAgeDays = 7)`：readdir → 读各 meta.json 的 `startedAt`（解析失败则用目录 mtime）→ 超期 `rm -rf`。调用点：① UI server 启动时 + 每小时；② 每次 CLI run/compact 开始时（best-effort，出错静默）。

## 3. 后端改动清单（后端 agent 负责）

**只许触碰：`src/`、`bin/`、`tools/`、根 `package.json`、`README.md`。禁止触碰 `ui/`。**

### 3.1 `src/acp-client.mjs`（最小改动）

- 构造器接受 `options.onChunk`（函数，可选）
- `handleLine` 中 `agent_message_chunk` 分支：`this.text += ...` 之后调用 `this.onChunk?.(update.content.text)`，包 try/catch——**回调抛错绝不能影响 ACP 流程**
- 不改任何协议行为，不加任何 capability

### 3.2 `src/task-recorder.mjs`（新文件，核心）

```js
createTaskRecorder({ command, name, prompt, model, targetCwd, invokerCwd })
// → { onChunk(text), setSessionId(id), finish({ status, error, reportPath, jsonPath, context }), taskId }
```

行为：
- 创建即写初始 meta.json（status: running, pid: process.pid）
- 内部 1s interval：写 throughput 采样行；每 2 个 tick 重写 meta（heartbeatAt/tokensOut/chars）
- `onChunk`: 累积估算 token、追加 output.md（可缓冲 ≤200ms 批量写，降低 IO）
- `finish`: 停 interval，终态 meta（endedAt、durationMs、context、report 路径）
- **所有 fs 操作 try/catch，失败静默降级（最多 stderr 提示一次）。监控绝不能弄挂主流程。**
- `process.on('exit')` 兜底：若未 finish，同步尽力把 status 写成 error + error:"process exited before finish"（同步 API：writeFileSync）
- 复用 `config.mjs` 的 `nowBeijingIso`/`nowBeijingStamp`

### 3.3 `src/cli.mjs` 接线

- `run()`：解析参数后创建 recorder（name 逻辑与现报告一致：`args.name || basename(prompt.source) 去扩展名`；invokerCwd = `process.cwd()`）；client 构造传 `onChunk: recorder.onChunk`；`runPrompt` 成功 → `recorder.setSessionId(...)`，取 context（`getSessionStatus({cwd, sessionId})`，失败容忍）→ `finish({status:'done', reportPath, jsonPath, context})`；catch → `finish({status:'error', error: message})` 后原样 rethrow
- `compact()`：同样接线，command:'compact'，name 沿用 `compact-<sessionId>`
- 新命令 `ui`：见 3.4
- `printHelp()` 增加 ui 命令与选项说明

### 3.4 `src/monitor-server.mjs`（新文件）+ `ui` 命令

`grok-acp ui [--port 41730] [--host 127.0.0.1]`

- 启动时：`cleanupOldRuns` → 扫描 runs/ 建内存索引 → 起 http server
- 静态服务：`<repo>/ui/dist`（mime: html/js/css/svg/json/map/woff2/png/ico；未命中的非 /api 路径回落 index.html）。dist 不存在时返回一页纯文本提示“先构建 ui：npm run ui:build”
- API（全部 `Cache-Control: no-store`，JSON UTF-8）：
  - `GET /api/tasks` → `{ tasks: [meta...] }`，每项附加 `"effectiveStatus"`：status==='running' 且（`kill(pid,0)` 抛错 或 now−heartbeatAt > 8000ms）→ `"interrupted"`，否则等于 status
  - `GET /api/tasks/:id` → `{ meta, samples: [[t,tps,cum], ...] }`（解析整个 ndjson）
  - `GET /api/tasks/:id/output?from=<charOffset>` → `{ "text": "<从 charOffset 起的增量>", "next": <新的总字符数>, "done": <effectiveStatus !== 'running'> }`（每次整读文件、按字符偏移切片；文件几十 KB、1Hz 轮询，够用）
  - `GET /api/events` → SSE：
    - 连接即发 `event: hello` `data: {"now":…,"runsDir":…}`；此后每 15s 发 `: ping` 注释行保活
    - `event: task` `data: <meta+effectiveStatus>`（新任务出现 / meta 变化 / effectiveStatus 翻转时）
    - `event: sample` `data: {"id":…,"t":…,"tps":…,"cum":…}`（throughput 新行）
- watch 策略：`fs.watch(runsDir)`（新目录 → 150ms 防抖重扫）+ 对 running 任务的目录各挂一个 watch（meta.json 变化 → 重读推 task；throughput.ndjson 变化 → 从记忆的字节偏移读新行推 sample）；任务终态后关闭其 watch。另有 2s interval 复核 interrupted 翻转。
- 安全：默认只绑 127.0.0.1；`:id` 参数必须 `decodeURIComponent` 后校验 `/^[0-9+\-a-f]+$/i` 且禁止路径分隔符，路径必须 resolve 后仍在 runsDir 内。
- 崩溃韧性：单个任务文件损坏（JSON 解析失败）跳过并 stderr 警告，不得让 server 挂掉。

### 3.5 `tools/dev-fake-task.mjs`(新文件，开发/验证用)

`node tools/dev-fake-task.mjs [--count 3] [--home /tmp/grok-acp-demo] [--duration-ms 60000]`

不调 Grok，直接按 §2 schema 模拟写任务：随机游走 tps（含偶发 0 停顿）、逐段追加中文+代码混合正文、一个长跑任务 + 若干已完成/一个 error 任务、不同 targetCwd（至少 2 个仓库路径以测分页）。这是集成验证的关键工具，schema 必须与 recorder 完全一致。

### 3.6 根 `package.json` scripts 追加

```json
"ui": "node ./bin/grok-acp.mjs ui",
"ui:build": "npm --prefix ui install && npm --prefix ui run build",
"fake": "node ./tools/dev-fake-task.mjs --home /tmp/grok-acp-demo"
```

lint script 追加新 .mjs 文件的 `node --check`。README 增补 ui 命令、monitor 一节（简短）。

### 3.7 验收（后端）

- `npm run lint` 通过
- `node tools/dev-fake-task.mjs --home /tmp/x` 后，`GROK_ACP_HOME=/tmp/x node bin/grok-acp.mjs ui --port 41731` 起服务；`curl /api/tasks`、`curl -N /api/events`（能看到 task/sample 事件流）、`curl "/api/tasks/<id>/output?from=0"` 全部符合契约
- 现有 run 流程回归：`npm run doctor`；（有 Grok 登录时）`npm run smoke` 后 `~/.grok-acp/runs/` 出现完整任务记录

## 4. 前端改动清单（前端 agent 负责）

**只许触碰：`ui/` 目录 + 根 `.hallmark/log.json`。禁止触碰 src/、bin/、根 package.json。**

### 4.1 脚手架

- Vite + React 18 + TypeScript（react-ts 模板）+ Tailwind v4（`@tailwindcss/vite`）+ `gsap` + `@gsap/react`
- `ui/vite.config.ts`：dev proxy `/api` → `http://127.0.0.1:41730`；`build.outDir = 'dist'`
- 字体：JetBrains Mono，**本地 self-host**（`@fontsource/jetbrains-mono` 的 400/500/700 woff2），不请求 Google Fonts（本地工具必须可离线）
- 构建产物 `ui/dist` 提交仓库；`ui/node_modules` 由 ui/.gitignore 排除；`package-lock.json` 提交

### 4.2 状态与数据流（`src/lib/api.ts` + `src/lib/store.ts`）

- `useReducer` 全局 store：`Map<taskId, TaskMeta>` + `Map<taskId, Sample[]>`（Sample = [t, tps, cum]）
- 启动：`GET /api/tasks` 全量 → 建 store；随后 `EventSource('/api/events')`：`task` 事件 upsert meta；`sample` 事件 push 采样（**内存中每任务上限 3600 点，超出丢头部**）
- 卡片迷你图数据：列表接口不带 samples；对 running 任务懒加载一次 `GET /api/tasks/:id` 取历史采样，之后靠 SSE 增量；对已完成任务，迷你图在卡片进入视口时（IntersectionObserver）懒加载一次
- SSE 断线：EventSource 自动重连；`onopen` 时重新全量 `GET /api/tasks` 校准；顶栏连接状态点 LIVE（常亮）/ RECONNECTING（闪烁）
- `?demo` 查询参数 → `src/lib/demo.ts` 纯前端合成数据（5 个任务、2 个仓库、1 个 running 随机游走、1 个 error、1 个 interrupted），不发任何网络请求。用于无后端预览与设计验收。

### 4.3 页面结构（自上而下）

1. **TopBar**（nav 原型 N9 edge-aligned minimal，高 44px，sticky）：左 `GROK ACP ▮ MONITOR` mono 字标；右侧依次：running 计数（`● 2 RUNNING` 磷光绿）、今日任务数、SSE 状态点
2. **RepoTabs**：`ALL` + 按 targetCwd 自动聚合的 tab（label = basename，title 显示全路径；按最近活动排序；tab 上有 running 数徽标）。选中态：磷光下划线 2px，无圆角
3. **TaskGrid**（宏结构 Bento Grid 的仪表盘化）：CSS grid，`grid-cols-12`，gap 16px
   - running 卡片在前（startedAt 降序），跨度大：`col-span-12 md:col-span-6 xl:col-span-6`
   - done/error/interrupted 随后（endedAt 降序），紧凑：`col-span-12 md:col-span-6 xl:col-span-3`
   - 尺寸差 = 状态节奏（bento 的 size variation 语义化）
4. **StatusBar**（footer 原型 Ft2 inline 单行）：`runs: ~/.grok-acp · retention: 7d · v0.2.0` 一行 muted mono 小字

### 4.4 TaskCard 规格

**running（大卡）**：
- 首行：StatusLed（磷光绿点，CSS 呼吸脉冲动画 2s）+ name（ink 色 500）+ model tag（muted 小字）
- 提示词预览：2 行 clamp，neutral 色
- **迷你速率图**：Canvas，高 72px 全宽，实时增长（见 §4.6）
- 底部数据行（mono，行情终端排布）：`TPS 42.5`（当前速率，ink 大一号）· `CUM 12.4k`（累计）· `ELAPSED 02:41`（每秒跳动）· ContextChip
- 左侧 2px 磷光绿描边（running 的持续视觉锚点）

**done（紧凑卡）**：LED 常亮 muted 绿 · name · duration · `CUM 8.2k` · 静态迷你图（64px 高，一次绘制）· ContextChip
**error**：LED 红 `--color-down`，卡片左描边红，显示 error 首行
**interrupted**：LED 琥珀 `--color-warn`，标注 `INTERRUPTED`
- 卡片均显示 targetCwd basename + 发起方 badge（`from: pm-project`，muted）
- hover：border 提亮至 rule-2 + 轻微磷光 glow（`box-shadow: 0 0 24px oklch(78% 0.19 138 / 0.08)`），120ms，只动 border-color/box-shadow；**禁止 scale**
- 整卡可点击 → 打开 DetailPanel；`:focus-visible` 磷光 ring 2px（无动画立现）

**ContextChip**（上下文水位）：`CTX OK/WATCH/MED/HIGH/CRIT` 小徽标；ok=muted 绿、watch/medium=琥珀、high=橙红、critical=红底闪烁禁止（静态红底即可）；context 为 null 时不渲染

### 4.5 DetailPanel（右侧滑出，宽 min(680px, 92vw)）

- GSAP x 位移滑入 260ms `--ease-out`；遮罩 fade；Esc / 点遮罩关闭；打开时 URL hash `#task=<id>`（可刷新直达）
- 内容自上而下：
  1. 标题行：LED + name + status 词（RUNNING/DONE/ERROR/INTERRUPTED）+ model + 起止时间
  2. **大速率图**：Canvas 高 240px，全历史，hover 十字线 + 数据 tooltip（t / tps / cum），右缘当前值标签——行情终端的核心质感所在（规格 §4.6）
  3. meta 表（两列 mono 小字）：taskId / sessionId / targetCwd / invokerCwd / report 路径 / tokens / duration / context 详情
  4. PROMPT 区：完整提示词，`<pre>` wrap，超 8 行折叠（SHOW ALL 展开）
  5. OUTPUT 区：流式正文。running 时 1s 轮询 `/api/tasks/:id/output?from=next` 追加；`FOLLOW` 开关（默认开，自动滚底；用户手动上滚即自动关，回底部自动开）。渲染：`<pre wrap>` 纯文本 + 仅识别 ``` 围栏换成深一档底色块——不做完整 markdown（保持轻）

### 4.6 ThroughputChart（Canvas 自绘，唯一图表组件，两种模式）

- props：`samples: [t,tps,cum][]`, `mode: 'mini' | 'full'`, `live: boolean`
- **绘制原则（dataviz 纪律）**：单序列单色（磷光绿 accent）；线宽 1.5px（mini 1px）；线下渐变填充 accent 8%→0%（唯一允许的渐变，数据可视化用途）；水平网格 hairline `--color-rule` 3~4 条；full 模式 y 轴右侧标 tps 刻度、x 轴下缘标 mm:ss，10px mono muted；无图例（单序列）、无边框盒
- x 轴 = 任务全时长映射到画布全宽（时间越长曲线越密——“时间轴拉长”的视觉）；y 轴 = 0 到 max(tps)×1.15，max 变化时 200ms 内插过渡避免跳变
- live 模式右端点画一个 3px 当前值圆点 + 右缘小值签（`42.5`,accent 底 paper 字），类似行情最新价标签
- 渲染：devicePixelRatio 缩放；**只在新样本到达或容器 resize 时重绘**（requestAnimationFrame 合帧），无空转循环；页面 `document.hidden` 时暂停重绘
- hover 十字线（仅 full）：mousemove → 最近样本索引，画 1px 十字虚线 + tooltip div（absolute 定位，mono 小字）

### 4.7 动效预算（GSAP，总计 4 处，不得追加）

| # | 动效 | 实现 | 时长 |
|---|------|------|------|
| 1 | 新卡片入场 | `gsap.from` autoAlpha 0 + y 8，stagger 0.05（useGSAP，scope 到 grid ref；仅对新增 id 触发，全量刷新不重播） | 240ms |
| 2 | 状态翻转（running→done/error） | gsap timeline：左描边色 crossfade + 卡片 border 一次性 flash（accent→rule） | 300ms |
| 3 | DetailPanel 滑入/出 | gsap x 位移 + 遮罩 autoAlpha | 260ms |
| 4 | LED 呼吸（running）| 纯 CSS `@keyframes`（opacity 0.4↔1），非 GSAP | 2s loop |

- `gsap.matchMedia` + `(prefers-reduced-motion: reduce)`：1/2/3 全部降级为 ≤150ms opacity；4 停止循环、常亮
- 禁：transition-all、hover scale、layout 属性动画、弹跳 easing。easing 只用 tokens 中三条曲线

### 4.8 视觉执行要点（tokens 见 §6，硬性）

- 所有颜色/字体/间距/圆角引用 CSS custom property，**禁止裸写色值**；Tailwind 里通过 `@theme` 映射 tokens
- 全站 JetBrains Mono（单字体即设计——终端页豁免双字体配对规则）；radius 全 0；卡片 1px 边框无阴影（hover glow 除外）
- `html, body { overflow-x: clip }`；768px 单列可用、无横向滚动；320px 不破版
- 界面 chrome 文案：英文大写 mono 短词（RUNNING / DONE / TPS / CUM / CTX / FOLLOW）——终端语感；正文数据（prompt/output）原样中文
- 空状态（无任务）：居中 mono 提示 `AWAITING FIRST DISPATCH` + 次行 `grok-acp run --prompt-text "…" 触发后此处实时出现`；不画装饰插图
- 誠實文案：不虚构任何数字；demo 模式在 TopBar 显示 `DEMO DATA` 琥珀徽标

### 4.9 Hallmark 记录义务（前端 agent 完成构建后执行）

- `ui/src/styles/tokens.css` 首行 stamp：
  `/* Hallmark · genre: atmospheric · macrostructure: Bento Grid (live dashboard adaptation) · theme: Terminal (semantic market palette) · enrichment: none · nav: N9 · footer: Ft2 */`
- 创建 `.hallmark/log.json`：`[{ "date": "2026-07-03", "macrostructure": "Bento Grid", "theme": "Terminal", "enrichment": "none", "brief": "grokACP monitor · dark trading-terminal dashboard" }]`
- 出码后自查 `/home/desk/.claude/skills/hallmark/references/slop-test.md` 中适用于产品 UI 的 gates（尤其 1/2/5/11/12/15/36/60/62），不通过必须修

### 4.10 验收（前端）

- `npm --prefix ui run build` 成功产出 dist；`tsc --noEmit` 无错
- 浏览器打开 `dist` 由后端 server 提供的页面，`?demo` 模式下：分页切换、卡片三态、迷你图/大图、详情面板、动效、reduced-motion 降级全部正确
- 无 console error；无网络 404（含字体）

## 5. 集成阶段（主控完成，两 agent 不做）

fake-task + server 真联调、Chrome DevTools 截图验证（桌面 1440 + 平板 768）、console/network 检查、根 .gitignore 与 CLAUDE.md 更新、最终 lint/smoke、（如有 Grok 登录）真实 run 验证端到端。

## 6. 设计系统 tokens（前端 agent 落盘为 `ui/src/styles/tokens.css`）

基于 Hallmark Terminal 主题，扩展行情语义色。**此块为最终值，不得改动：**

```css
:root {
  /* paper & structure — 近黑磷光底 */
  --color-paper:    oklch(11% 0.018 145);
  --color-paper-2:  oklch(15% 0.022 145);
  --color-paper-3:  oklch(19% 0.024 145);
  --color-rule:     oklch(28% 0.030 140);
  --color-rule-2:   oklch(40% 0.050 140);

  /* ink ladder — 磷光绿阶 */
  --color-muted:    oklch(58% 0.090 140);
  --color-neutral:  oklch(68% 0.120 140);
  --color-ink-2:    oklch(78% 0.140 138);
  --color-ink:      oklch(86% 0.160 138);
  --color-accent:   oklch(78% 0.190 138);
  --color-focus:    oklch(86% 0.190 138);

  /* market semantics — 行情语义 */
  --color-up:       oklch(78% 0.190 138);   /* running / live */
  --color-down:     oklch(64% 0.190 25);    /* error */
  --color-warn:     oklch(76% 0.150 85);    /* interrupted / ctx watch */
  --color-crit:     oklch(58% 0.210 25);    /* ctx critical */

  /* type — 单字体终端 */
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  --text-xs: 0.6875rem; --text-sm: 0.8125rem; --text-base: 0.9375rem;
  --text-lg: 1.125rem;  --text-xl: 1.5rem;    --text-2xl: 1.875rem;
  --tracking-label: 0.18em;
  --lh-tight: 1.2; --lh-normal: 1.55;

  /* space — 4pt scale */
  --space-2xs: 0.25rem; --space-xs: 0.5rem; --space-sm: 0.75rem;
  --space-md: 1rem; --space-lg: 1.5rem; --space-xl: 2rem; --space-2xl: 3rem;

  /* shape & motion */
  --radius-card: 0; --radius-pill: 0; --rule-card: 1px;
  --glow-live: 0 0 24px oklch(78% 0.19 138 / 0.08);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-micro: 120ms; --dur-short: 240ms; --dur-panel: 260ms;

  --z-sticky-nav: 300; --z-panel: 400; --z-tooltip: 600;
}
```

ContextChip 映射：ok→muted 绿字 / watch·medium→`--color-warn` / high→`--color-down` / critical→`--color-crit` 底 + paper 字。

---

## 7. v2 变更（用户验收反馈，2026-07-04）

### 7.1 删除功能

**后端契约（monitor-server.mjs）：**
- `DELETE /api/tasks/:id`：
  - id 校验复用 resolveTaskId → 非法 400 `{error:"invalid task id"}`；不存在 404
  - `effectiveStatus === 'running'` → 409 `{error:"task is running"}`（运行中禁止删除）
  - 成功：关闭该任务 watcher → `fs.rmSync(dir, {recursive:true, force:true})` → `tasksById.delete` → 广播 SSE `event: deleted` `data: {"id":"<taskId>"}` → 200 `{ok:true, id}`
- SSE 新事件类型 `deleted`

**前端：**
- api.ts 增加 `deleteTask(id)`；store 处理 `deleted` SSE 事件与本地删除（幂等）；若详情面板正开着被删任务则关闭面板
- 已结束卡片（done/error/interrupted）右上角"×"ghost 按钮（hover 显现，触屏常显）；running 卡片无删除按钮；点击直接 DELETE，成功后卡片 GSAP 淡出收起（reduced-motion 降级为直接移除）
- RepoTabs 行右侧新增按钮 `清理已结束 (N)`：N=当前分页非 running 任务数，点击弹一次原生 confirm，确认后逐个 DELETE

### 7.2 视觉重设计 v2 —— "Graphite" 中性暗色（替换 §6 Terminal 主题）

用户反馈：不要满屏绿、不要全直角的复古终端感；保留暗色，卡片用浅灰色（相对底色更亮的中性灰面），整体更现代（参照 Linear/Vercel 暗色仪表盘质感）。绿色只保留为"运行中"语义色。

**tokens.css `:root` 全量替换为（最终值）：**

```css
--color-paper:    oklch(15% 0.006 260);   /* 页面底：中性冷灰近黑 */
--color-paper-2:  oklch(24% 0.008 260);   /* 卡片面：明显浅一档的灰 */
--color-paper-3:  oklch(30% 0.010 260);   /* 内嵌块 / pre / hover 面 */
--color-rule:     oklch(36% 0.010 260);
--color-rule-2:   oklch(48% 0.012 260);
--color-muted:    oklch(64% 0.012 260);
--color-neutral:  oklch(75% 0.010 260);
--color-ink-2:    oklch(86% 0.006 260);
--color-ink:      oklch(94% 0.004 260);
--color-accent:   oklch(70% 0.145 250);   /* 现代蓝：图表线/焦点/选中态 */
--color-focus:    oklch(74% 0.145 250);
--color-up:       oklch(72% 0.170 150);   /* 绿仅用于 running 语义 */
--color-down:     oklch(65% 0.190 25);
--color-warn:     oklch(77% 0.140 85);
--color-crit:     oklch(58% 0.210 25);
--radius-card:    10px;                   /* 卡片/面板/pre 块 */
--radius-pill:    6px;                    /* 按钮/chip/徽标 */
--shadow-card:    0 1px 2px oklch(0% 0 0 / 0.35);
--shadow-hover:   0 4px 16px oklch(0% 0 0 / 0.40);
--glow-live:      0 0 0 1px oklch(72% 0.17 150 / 0.22);
```

字体/字号/间距/easing/duration/z-index tokens 不变（JetBrains Mono 保留，mono 数据感 + 中性灰 + 圆角 = 现代仪表盘）。

**应用规则：**
- 卡片、详情面板、pre 块、空态容器：`border-radius: var(--radius-card)`，卡片加 `box-shadow: var(--shadow-card)`
- 按钮、ContextChip、DEMO 徽标、FOLLOW 开关：`border-radius: var(--radius-pill)`
- 卡片 hover：border-color → rule-2 + `box-shadow: var(--shadow-hover)`（替换原磷光 glow）
- running 卡片：左侧 2px 绿描边保留 + `box-shadow: var(--glow-live)` 细环
- 图表线/填充/右缘值签用 `--color-accent`（蓝），不再用绿；当前值圆点保留
- tokens.css 首行 stamp 的 theme 字段更新为 `theme: Graphite (custom neutral dark, user-directed v2)`
- .hallmark/log.json 头部追加一条 v2 记录（theme: custom, theme_axes: dark / mono / cool-blue）

### 7.3 详情面板改为居中弹窗（v2.1）

- 触发：用户反馈"卡片点击后展开的页面不要放在屏幕右侧，直接在屏幕中央展开"。
- DetailPanel 由右侧全高抽屉改为居中 modal：`min(760px, 92vw)` 宽、`min(86vh, 900px)` 最大高、四角 `--radius-card` 圆角、四边 `--rule-card` 边框、`--shadow-hover` 阴影，内部滚动。
- 动画由 xPercent 横向滑入改为 scale 0.96→1 + 淡入（0.26s token-ease-out），reduced-motion 降级仍为纯淡入淡出。
- 遮罩、Esc/遮罩点击关闭、aria 属性、缓存状态机均不变。

### 7.4 详情弹窗内容升级 + 卡片信息增强 + 图表竞态修复（v2.2）

- 详情弹窗加宽至 `min(960px, 94vw)`、最大高 `min(88vh, 1000px)`；元信息 `<dl>` 在 md+ 断点改双栏（`md:grid-cols-[auto_1fr_auto_1fr]`）。
- OutputStream 由"仅切分 ``` 围栏"升级为手写轻量 Markdown 渲染（零依赖）：围栏代码块（含语言标签行）、`#`~`####` 标题、`-`/`*` 列表、`**加粗**`、行内代码、`---` 分隔线、空行段距；不支持的语法按普通文本行降级，绝不报错。滚动容器去掉 pre-wrap（换行由行级 div 承担），行高 1.7，最大高 55vh。
- ContextChip 文案由等级词（"上下文正常"等）改为 `上下文 {pct}% · {tokens}`，等级仅体现在颜色与 tooltip（tooltip 含完整解释与等级词）。等级阈值不变（session-store.mjs classifyContext）。
- CompactCard 新增信息行：`启动 MM-DD HH:mm`（北京时间，直接截取 ISO 字符串避免观看端时区换算）+ 模型名（去 `grok-` 前缀，`shortModel`）；RunningCard 的速率行追加 `启动` 时间。format.ts 新增 `formatCardTime` / `shortModel`。
- 卡片 ✕ 删除增加 `window.confirm` 二次确认（防误触），DeleteButton props 由 taskId 改为整个 task（取任务名入文案）。
- **修复迷你折线图经常空白的竞态**：ThroughputChart 的 ResizeObserver / visibilitychange effect（`[]` 依赖）持有首渲染的 `scheduleDraw`，其闭包 samples 为空；共享 `rafRef` 去重导致新样本触发的重绘被跳过、RAF 执行空样本旧 draw 后清屏返回，已完成任务无后续样本事件则永久空白。修复采用 latest-ref 模式：`drawRef.current = draw` 每渲染刷新，`scheduleDraw` 改为 `useMemo(..., [])` 永久稳定、RAF 回调调 `drawRef.current()`。

### 7.5 输出"执行过程 / 最终结果"分段 + 上下文窗口总长 + 卡片视觉层级（v2.3）

- **分段契约**：ACP 流中 `tool_call` / `tool_call_update` 事件是过程与结果的协议级分界。`acp-client.mjs` 新增 `onToolEvent` 回调（仅观察通知，不改协议交互，clientCapabilities 红线未动）；`task-recorder.mjs` 在每次工具事件时把 `state.resultStart` 更新为当前累计字符数并随 meta 落盘。语义：`resultStart` 为 output.md 的字符偏移（与输出接口 from/next 同口径）；最后一次工具事件之后的消息即最终结果；0 = 全程无工具调用；老 meta 无此字段。
- **UI 分段渲染**（OutputStream）：`resultStart > 0` 时输出分两段——"执行过程"（灰标签，整体 78% 不透明度压暗）与"最终结果"（绿标签，半透明绿底圆角框 `--color-up-tint` / `--color-up-tint-border`）；`resultStart === 0` 且已结束 → 全部为结果；无字段（老任务）→ 按原样整体渲染。
- **上下文窗口总长**：`toMetaContext` 透传 session-store 已有的 `contextWindowTokens` 为 `context.windowTokens`（Composer 200k / Grok 4.3 500k 等）。ContextChip 文案改为 `上下文 {pct}% · {已用}/{总长}`，ok 等级颜色由 muted 提为 neutral；详情弹窗上下文行同步加分母。
- **卡片视觉层级**：新增 `Metric` 组件统一"标签弱灰 + 数值 ink-2 加重(500)"语言；任务名提至 ink+500；模型名加细边框药丸；FooterMeta 目标仓库名提为 neutral；`formatCount` 去除无意义 `.0`（200.0k → 200k）。

### 7.6 累计输出 / 累计消耗 / 压缩次数（v2.4）

- 文案更正："累计"（tokensOut 输出估算）改为"累计输出"（卡片与详情页同步）。
- 新增"累计消耗"：`consumedTokens = signals.totalTokensBeforeCompaction + contextTokensUsed`。前者是 Grok 历次压缩前 token 的累计和（实测 8 次压缩会话该值 1,261,844 = 各次 tokens_before 之和），故该指标跨压缩只增不减；无压缩时退化为当前上下文已用。由 `toMetaContext` 计算并随 context 落盘。
- 新增压缩次数：`context.compactionCount`；卡片上 >0 时显示琥珀色 `压缩 ×N` 药丸（tooltip 解释），详情页元信息表恒显"压缩次数"行。
- 老任务 meta 无新字段 → UI 优雅降级（累计消耗显示 —，压缩药丸不出现）。

### 7.7 输出渲染器支持 Markdown 表格（v2.4.1）

- `renderTextBlock` 改为游标循环：`|` 表格行 + 下一行 `|---|` 分隔行 → 渲染带边框 `<table>`（表头 `--color-rule-2` 边框 + paper 底、表体 `--color-rule` 边框，横向可滚动），单元格内容走 `renderInline`。
- 降级：无分隔行的孤立 `|` 行按普通文本显示；参差列数照常渲染；两个分段内均生效。
