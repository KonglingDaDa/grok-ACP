# grokACP — Claude Code Guide

Thin Node.js dispatcher that talks to Grok CLI over ACP stdio JSON-RPC. PM agents use it to dispatch bounded Grok tasks without hand-writing RPC.

**Repository:** https://github.com/KonglingDaDa/grok-ACP.git

## What This Project Is

- A **wrapper**, not an orchestration platform. Task splitting, acceptance criteria, and final review stay in the PM prompt.
- One prompt → one ACP session (fresh by default) → one archived reply (Markdown + JSON).
- Zero npm dependencies. Node.js 20+, ESM (`"type": "module"`), native APIs only.

## Architecture

```
bin/grok-acp.mjs     Entry point; delegates to cli.mjs
src/cli.mjs          Commands: run, new, status, compact, doctor, help
src/acp-client.mjs   GrokAcpClient — spawns grok agent stdio, JSON-RPC over stdin/stdout
src/config.mjs       Defaults, arg parsing, prompt loading, Beijing timestamps
src/report.mjs       Writes <stamp>-<name>.md and .json run reports
src/session-store.mjs Reads ~/.grok/sessions/ for context status (no ACP needed)
```

### ACP lifecycle (`GrokAcpClient`)

1. Spawn: `grok --no-auto-update agent --always-approve --model <model> stdio`
2. `initialize` with `{ protocolVersion: 1, clientCapabilities: {} }`
3. `authenticate` — prefer `xai.api_key` if `XAI_API_KEY` set, else `cached_token`
4. `session/new` (default) or `session/load` (with `--session-id`)
5. `session/prompt` — stream reply via `session/update` → `agent_message_chunk`
6. `waitForStableText` — poll until text length stabilizes before returning

### Critical design constraint

**Never advertise `fs` or `terminal` client capabilities** unless you implement the corresponding JSON-RPC callbacks in `acp-client.mjs`. Grok CLI runs its own Shell/Write tools under `--always-approve`. Claiming unimplemented client tools leaves tool calls pending until `session/prompt` times out.

`--always-approve` is mandatory and hard-coded in `cli.mjs`. Do not make it opt-out without explicit product reason.

## Commands

| Command | Purpose |
| --- | --- |
| `doctor` | Verify `grok` binary and `agent stdio --help` |
| `run` | Send prompt; write report; print reply (unless `--quiet`) |
| `new` | Create session only; print `sessionId` |
| `status` | Read local Grok session files for context usage |
| `compact` | Send `/compact [context]`; report before/after status |

Entry:

```bash
node /home/desk/dev/repos/grokACP/bin/grok-acp.mjs <command> [options]
```

Or via npm scripts from repo root.

## Defaults (`src/config.mjs`)

| Constant | Value |
| --- | --- |
| `DEFAULT_MODEL` | `grok-composer-2.5-fast` |
| `DEFAULT_ZQ_CWD` | `/home/desk/dev/repos/zq` |
| `--timeout-ms` | `1200000` |
| `--out-dir` | `<cwd>/.codex-artifacts/grok-acp-runs` |

Change `DEFAULT_ZQ_CWD` only when the primary dispatch target repo moves.

## Development

### Verify changes

```bash
npm run lint          # node --check on all .mjs files
npm run doctor        # grok CLI availability
npm run smoke         # short inline prompt, writes to ./.runs
npm run smoke:write   # end-to-end: Grok writes /tmp/grok-acp-write-smoke.txt
```

`smoke` and `smoke:write` require a logged-in Grok CLI (`grok login`) or `XAI_API_KEY`.

```bash
npm run test:monitor   # fake tasks + monitor API/SSE/DELETE (no Grok)
```

### Run tests

```bash
npm test          # 运行所有测试（包括 smoke）
npm run test:watch  # 监听模式，文件改动自动重跑
node --test test/smoke.test.mjs  # 只跑 smoke 测试
```

**测试框架：** Node.js 原生 `node:test`（需要 Node 20+），零 npm 依赖。

**测试文件命名：** `test/<name>.test.mjs`

**写测试时遵循 TDD 模式：**
1. 先写测试（包含所有边界情况）
2. 验证测试失败（红）
3. 写实现
4. 验证测试通过（绿）

详见 `工程师任务/2026-07-04-0340-AI友好化-测试与文档/PRD.md` §2.2。

### GitNexus (code graph — use proactively)

This repo is indexed as **`grokACP`**. Prefer GitNexus over blind grep when you need **execution flows, blast radius, or review scope** — especially across `src/`, `tools/`, and `ui/src/`.

**Keep the index fresh** (after meaningful edits, or when `list_repos` shows staleness):

```bash
cd /home/desk/dev/repos/grokACP
gitnexus analyze --index-only --name grokACP
```

`--index-only` skips injecting AGENTS.md / skills; safe for repeat runs.

**MCP workflow (flexible — pick what fits the task):**

| Step | Tool | Use when |
| --- | --- | --- |
| 1 | `list_repos` | Confirm `grokACP` is indexed; check staleness hint |
| 2 | `detect_changes` `{ "repo": "grokACP", "scope": "all" }` | Pre-commit / code review: map diff → symbols → affected processes |
| 3 | `query` `{ "repo": "grokACP", "query": "…", "task_context": "…" }` | Find how a feature fits together (e.g. monitor recorder, SSE, onChunk) |
| 4 | `context` `{ "repo": "grokACP", "name": "…", "file_path": "…" }` | 360° view of one symbol: callers, callees, process membership |
| 5 | `impact` `{ "repo": "grokACP", "target": "…", "direction": "upstream", "file_path": "…" }` | Before editing shared code (e.g. `handleLine`, `dispatchRecordedPrompt`): what breaks |

Always pass `"repo": "grokACP"` — multiple repos may be indexed on the same machine.

**CLI equivalents** (no MCP): `gitnexus query`, `context`, `impact`, `detect-changes -r grokACP`.

**Practical combos:**

- **Code review:** `detect_changes` → `impact` on changed hub symbols → `context` on anything HIGH risk → read files only where the graph points.
- **New feature / unfamiliar area:** `query` with a natural-language goal → `context` on top process symbols → grep/read for line-level detail.
- **Refactor:** `impact` upstream on the symbol you plan to move/rename → adjust callers the graph lists before coding.

**Limits:** `detect_changes` only sees **git-tracked** diffs; untracked new files still appear in the index after `analyze`, but won't show in `detect_changes` until added. Grep/file read remain right for exact strings, config flags, and markdown contracts (`docs/monitor-ui-design.md`).

### Code style

- Plain `.mjs` modules; no TypeScript, no bundler. Tests use the native `node:test` runner (`test/*.test.mjs`); `ui/` uses vitest.
- Use `node:fs`, `node:path`, `node:child_process`, `node:readline`.
- CLI args parsed manually in `parseArgs()` — kebab-case flags map to camelCase keys.
- Errors throw `Error` with actionable messages; `bin/grok-acp.mjs` prints stack and exits 1 — except recoverable timeouts (`error.isTimeout`), which print a resume hint and exit 2.
- Beijing timezone for report filenames and timestamps (`nowBeijingIso`, `nowBeijingStamp`).

### What to ignore

- `.runs/` — local smoke output (gitignored)
- `node_modules/` — not used

## Session & context management

`status` reads `~/.grok/sessions/<encodeURIComponent(cwd)>/<session-id>/`:
`signals.json`, `summary.json`, `updates.jsonl`, `prompt_context.json`, `chat_history.jsonl`.

PM thresholds in `classifyContext()` (`session-store.mjs`):

| Level | Trigger | Recommendation |
| --- | --- | --- |
| ok | < 100k tokens | ordinary small tasks |
| watch | ≥ 100k | short tasks only |
| medium | ≥ 120k | compact or new session before non-trivial work |
| high | ≥ 75% usage or ≥ 150k | compact or new session before next task |
| critical | ≥ 85% usage or ≥ 170k | do not dispatch; compact or new session |

**Default PM rule:** one fresh session per task. Use `--session-id` only when continuity matters.

## Output contract

Each `run` / `compact` writes:

```text
<out-dir>/<YYYYMMDDHHMMSS+08>-<slug-name>.md
<out-dir>/<YYYYMMDDHHMMSS+08>-<slug-name>.json
```

Stderr lines for automation:

```text
grokACP sessionId=...
grokACP report=...
grokACP json=...
```

## Safe change areas

| Change | Touch |
| --- | --- |
| New CLI flag | `config.mjs` (if parsed), `cli.mjs`, `printHelp()`, README |
| ACP protocol | `acp-client.mjs` only |
| Report fields | `report.mjs` |
| Context thresholds | `session-store.mjs` `classifyContext()` |
| Smoke / lint | `package.json` scripts |

## Anti-patterns

- Adding npm dependencies for convenience — keep the tool dependency-free.
- Implementing a task queue, worker pool, or multi-agent scheduler here.
- Advertising ACP client capabilities without full callback implementation.
- Removing `--always-approve` or making Grok wait on permission prompts.
- Committing `.runs/` or generated reports from other projects.

## Git

```bash
git add -A && git commit -m "..." && git push
```

Branch: `main`. Remote: `origin` → https://github.com/KonglingDaDa/grok-ACP.git