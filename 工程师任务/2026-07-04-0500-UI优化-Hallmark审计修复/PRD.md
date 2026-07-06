# PRD：grokACP 监控 UI — Hallmark 审计修复

**专题编号：** 2026-07-04-0500-UI优化-Hallmark审计修复  
**PM：** Claude (Fable 5)  
**执行工程师：** Grok Composer 2.5 Fast (via grokACP)  
**优先级：** P0（Critical 问题阻止发货）

---

## 背景

Hallmark 审计发现监控 UI 有 **7 个 Critical、5 个 Major、6 个 Minor** 问题。本 PRD 聚焦 **Phase 1（Critical）+ Phase 2（Major）修复**，共 8 个问题，拆分为 5 个任务派发。

**审计报告：** 见本目录 `Hallmark-审计报告.md`（如需）

---

## 目标

1. **Critical 修复（T1-T3）**：修复零 chroma 中性色、引入 display 字体配对、升级 Nav+Footer 组合
2. **Major 增强（T4-T8）**：增强卡片视觉层级、优化动效、添加入场动画

**验收标准：**
- Hallmark 审计 Critical 问题全部修复（7 → 0）
- Major 问题全部修复（5 → 0）
- 所有现有测试通过（`npm run test:all`）
- 监控 UI 在浏览器中视觉验证通过（Chrome DevTools MCP 截图对比）
- 不引入新的 regression

---

## 任务清单

| 编号 | 任务 | 优先级 | 预计耗时 | 依赖 |
|---|---|---|---|---|
| T1 | Critical 修复：Chroma + 字体 + Nav/Footer | P0 | 15 分钟 | 无 |
| T2 | Major 增强：卡片 + 面板视觉 | P1 | 10 分钟 | T1 |
| T3 | Major 增强：Repo Tabs 滑动动画 | P1 | 8 分钟 | T1 |
| T4 | Major 增强：页面级入场动画 | P1 | 12 分钟 | T1 |
| T5 | Major 增强：LED 去同步化 | P1 | 6 分钟 | T1 |

**总预计：** 51 分钟（20 分钟超时足够单个任务）

---

## 技术约束

1. **保持现有 token 系统** — 所有颜色/字体必须通过 CSS custom properties 引用，不得内联 OKLCH 值
2. **GSAP 动效预算** — 新增动效必须遵循 motion-safe + prefers-reduced-motion fallback
3. **React 18 + Tailwind v4** — 保持现有技术栈，不引入新依赖
4. **零 regression** — 所有现有功能（卡片删除、面板打开、Tab 切换、SSE 更新）必须保持工作
5. **浏览器验证** — 每个任务完成后必须用 Chrome DevTools MCP 截图验证

---

## 不做的事（Out of Scope）

- Minor 问题（删除按钮 opacity、hover shadow timing 等）— 留到后续迭代
- 新功能开发 — 本次只做视觉和动效优化
- 重写组件 — 原地增强，不重构架构
- 更换 GSAP 以外的动画库

---

## 验收流程

每个任务完成后：
1. `npm run lint` — 无错误
2. `npm run test:all` — 全部通过
3. `npm run build` — 构建成功
4. `npm run dev` — 启动监控 UI
5. Chrome DevTools MCP 截图 — 对比修改前后

全部任务完成后：
- 提交完整的验收报告（包含截图对比、测试结果、性能指标）
- 更新 Hallmark stamp（tokens.css 第一行）

---

## 参考资料

- **Hallmark 审计报告**：本次对话上文
- **现有代码**：`ui/src/components/`, `ui/src/styles/`
- **GSAP 文档**：项目已安装 `gsap@^3.13.0` + `@gsap/react@^2.1.2`
- **Tailwind v4 文档**：项目使用 `@theme inline` 桥接 tokens.css

---

## 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| 字体加载失败（Inter Tight 不在 @fontsource） | 中 | 高 | 回退到 Inter variable 或 DM Sans |
| GSAP 动画与 React 18 concurrent 模式冲突 | 低 | 中 | 使用 useGSAP hook + dependencies 数组 |
| 新动效导致性能下降（低端设备） | 中 | 中 | 添加 will-change + GPU 加速 + motion-safe 检查 |
| Nav/Footer 改造破坏响应式布局 | 低 | 高 | 测试 320/375/768/1024px 四个断点 |

---

**PM 签字：** Claude (Fable 5) — 2026-07-04 05:15
