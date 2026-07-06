# grokACP 工程护栏 Playbook

> 决定软件质量的不是模型参数，而是工程护栏的完整程度。AI 只是把这个事实放大 5–10 倍。
> —— 本项目对 Scott Hanselman “AI reflects your SDLC back at you” 的落地实践。

本文件描述 grokACP 对**所有代码（人类写的、Grok 生成的、子 agent 提交的）一视同仁**的验证纪律。配套的 PM/Grok 协作约束见仓库外 `pm与Grok协作约束文档-v4-ACP优化版.md`。

## 0. 核心原则：把 AI 代码当成“陌生人提交的 PR”

不是不信任，而是建立**可执行的信任机制**。无论代码来源，都必须走完相同的验证循环：lint → 测试 → 覆盖率地板 → 审查 → 来源追溯。

## 1. 三层护栏

| 层 | 机制 | 强制性 | 覆盖 |
|---|---|---|---|
| CI | `.github/workflows/ci.yml`（GitHub Actions） | 强制（push/PR 触发） | lint、后端测试（Node 20+22）、覆盖率地板、UI 测试+构建 |
| 本地 | `.githooks/pre-commit`（native git hook） | opt-in（需手动启用） | lint、后端测试 |
| 流程 | 本 playbook + v4 协作约束 | 人工遵循 | AI 代码审查清单、脱敏、provenance |

## 2. 启用本地 pre-commit hook

零依赖，基于 git 原生 `core.hooksPath`（不引入 husky/lint-staged）：

```bash
git config core.hooksPath .githooks
```

启用后每次 `git commit` 会先跑 lint + 后端测试，失败则拒绝提交。应急跳过：`git commit --no-verify`（仅在明确知道自己在做什么时）。

## 3. CI 强制什么

- **backend**（Node 20 + 22 矩阵）：`npm run lint`（`node --check` 全部 `.mjs`）+ `npm test`（`node:test`，零依赖）。`test/smoke.test.mjs` 需要真实 grok CLI，无 grok 的环境（含 CI）会自动 `skip`，不影响绿。
- **coverage**（Node 22）：`npm run coverage` —— 源码覆盖率地板 `lines≥35 / branches≥55 / funcs≥42`（排除 `test/`、`tools/`）。这是**防倒退地板**，不是目标。
  - **口径（重要）**：Node `--experimental-test-coverage` 会**合并子进程覆盖率**。`test/smoke.test.mjs` 在本地（有 grok）以子进程跑真实 `bin→cli→acp-client` 全链路，会把覆盖率灌到 ~56%；但 CI 无 grok、smoke 自动跳过，覆盖率回落到单测真实值（~40% lines / ~68% branch / ~48% funcs）。**地板按 CI 真实条件（grok 缺失）设定**，故数字偏低是刻意的——它约束的是可移植单测覆盖的 `src/` 子集，不含 `cli`/`monitor-server`/`monitor-routes`/`session-store` 等由集成测试（smoke、`npm run test:monitor`）覆盖的部分。
  - **仅 Node 22+**：覆盖率阈值 flag（`--test-coverage-lines` 等）是 Node 22 引入的，`npm run coverage` 必须在 Node 22 跑（本地 Node 20 会不 enforce）。CI 已固定在 Node 22。
- **monitor**（Node 22）：`npm run test:monitor` —— 监控 HTTP/SSE/DELETE 契约集成测试。用临时 `GROK_ACP_HOME` + 假任务（`dev-fake-task`），**不需要 grok**，故在 CI 强制跑。
- **ui**（Node 22）：`npm ci` + `vitest run` + `vite build`（含 `tsc -b --noEmit` 类型检查）。

CI 全绿是合入 `main` 的前置条件。

## 4. AI 生成代码合入前清单

把每次 Grok/子 agent 产出当作 PR 过一遍：

- [ ] **范围**：只动了任务白名单内的文件？无未授权 npm 依赖？
- [ ] **验证**：lint 绿、`npm test` 绿、覆盖率未跌破地板？
- [ ] **异常路径**：改了 retry/fallback/超时逻辑时，原 happy path 有回归证明？
- [ ] **Critic 自审**：非小改动是否派了对抗性复审并处理了 CONFIRMED 发现？
- [ ] **敏感数据**：无硬编码密钥；C2C/资金链路原始报告未入库，交付走 `*.redacted.json`（见 v4 硬门禁第 7 条）。
- [ ] **provenance**：改动已 commit、回执/任务文档留痕。

## 5. Provenance（来源追溯）

- **代码必须在 git 里**——未入库的代码不受任何护栏保护。
- 生成物**不入库**：`.codex-artifacts/`（Grok 回执+截图）、`.gitnexus/`（代码图谱索引）、`.hallmark/`、`ui/node_modules`、`ui/dist` 均在 `.gitignore`。
- 任务文档与回执（`工程师任务/`）**入库**，作为工程过程的审计轨迹。

## 5.1 测试隔离（别污染真实监控）

- 会 spawn `grok-acp run` 的测试（`test/smoke.test.mjs`、`npm run smoke`）**必须**用临时 `GROK_ACP_HOME`（`fs.mkdtempSync` / `$(mktemp -d)`）把任务记录写进可丢弃目录，绝不落进用户真实的 `~/.grok-acp/runs`——否则测试任务会当噪音显示在监控面板上。
- 监控对"运行中但进程已死"的任务显示"已中断"；`recheckInterrupted` 每次回磁盘重读 meta，让快速完成、`fs.watch` 漏掉终态写入的任务自愈成 done，不会永远卡在"已中断"。

## 6. 零依赖铁律

主仓库不得新增任何 npm 依赖（`dependencies` / `devDependencies` 恒为空）。所有护栏都用 Node 原生能力实现：`node --test`、`node --check`、`--experimental-test-coverage`、native git hook。新增护栏时同样遵守此约束；`ui/` 子目录是唯一例外。