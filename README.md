# grokACP

Thin Node.js wrapper around the Grok CLI ACP entrypoint:

```bash
grok --no-auto-update agent --always-approve --model grok-composer-2.5-fast stdio
```

The project exists so a PM agent can dispatch one bounded Grok task from Codex without hand-writing JSON-RPC every time. It intentionally keeps the tool small: one prompt, one fresh session, one archived reply.

## Why This Shape

- Use the official `grok agent stdio` ACP transport.
- Start ACP with `--always-approve` by default so Grok can execute approved tool work without permission prompts.
- Do not advertise client-side `fs` or `terminal` capabilities; Grok CLI should run its own Shell/Write tools. If this wrapper claims unimplemented client tools, tool calls can remain pending until `session/prompt` times out.
- Keep each Grok task isolated in a fresh session by default.
- Preserve evidence: prompt source, session id, model, cwd, stop reason, stdout text, and stderr.
- Avoid a second orchestration platform. Task splitting and acceptance criteria still belong to the PM prompt.

## Install / Run

No npm dependencies are required. Node.js 20+ and a logged-in Grok CLI are required.

```bash
cd /home/desk/dev/repos/grokACP
npm run doctor
npm run smoke:write
```

Run a task from a prompt file:

```bash
node /home/desk/dev/repos/grokACP/bin/grok-acp.mjs run \
  --cwd /home/desk/dev/repos/zq \
  --prompt-file /home/desk/dev/repos/zq/工程师任务/YYYY-MM-DD-HHMM-任务标题.md \
  --out-dir /home/desk/dev/repos/zq/.codex-artifacts/grok-acp-runs
```

Run a short inline prompt:

```bash
node /home/desk/dev/repos/grokACP/bin/grok-acp.mjs run \
  --cwd /home/desk/dev/repos/zq \
  --prompt-text "用一句中文回复：ACP 调用成功。"
```

## AI-Facing CLI Contract

Command:

```bash
node /home/desk/dev/repos/grokACP/bin/grok-acp.mjs run [options]
```

Required prompt input, exactly one:

| Option | Meaning |
| --- | --- |
| `--prompt-file <path>` | Read the full Grok task prompt from a UTF-8 file. Preferred for PM task dispatch. |
| `--prompt-text <text>` | Inline prompt for smoke tests or tiny tasks. |

Execution options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--cwd <path>` | `/home/desk/dev/repos/zq` | Working directory passed to ACP `session/new` and used to spawn Grok. |
| `--model <id>` | `grok-composer-2.5-fast` | Model passed to `grok agent --model <id> stdio`. |
| `--timeout-ms <number>` | `120000` | Timeout for each JSON-RPC request. Increase for long tasks. |
| `--out-dir <path>` | `<cwd>/.codex-artifacts/grok-acp-runs` | Directory for Markdown and JSON run reports. |
| `--name <name>` | prompt filename | Human-readable report suffix. |
| `--quiet` | false | Suppress Grok reply on stdout; reports are still written. |
| `--session-id <id>` | unset | Load an existing Grok session with ACP `session/load`, then send the prompt there. |
| `--grok-bin <path>` | `grok` | Grok executable path. |
| `--debug` | false | Pass `--debug` to `grok agent stdio`. |
| `--debug-file <path>` | unset | Pass `--debug-file` to `grok agent stdio`. |
| `--leader-socket <path>` | unset | Pass `--leader-socket` to `grok agent stdio`. |

Doctor command:

```bash
node /home/desk/dev/repos/grokACP/bin/grok-acp.mjs doctor
```

It verifies the local Grok CLI and `agent stdio` entrypoint.

Every ACP process is started as:

```bash
grok --no-auto-update agent --always-approve --model grok-composer-2.5-fast stdio
```

`--always-approve` is mandatory for PM dispatch so Grok does not stall on permission prompts.

The ACP client intentionally initializes with:

```json
{ "protocolVersion": 1, "clientCapabilities": {} }
```

This is deliberate. The wrapper is a dispatcher, not an editor or terminal host. Grok CLI's own approved tools perform shell and file writes under `--always-approve`; declaring `fs.writeTextFile`, `fs.readTextFile`, or `terminal` here would require this wrapper to implement those JSON-RPC callbacks.

## Session And Context Commands

Create a fresh session without sending a task:

```bash
node /home/desk/dev/repos/grokACP/bin/grok-acp.mjs new \
  --cwd /home/desk/dev/repos/zq
```

Read context status for the latest session in a cwd, or for a specific session:

```bash
node /home/desk/dev/repos/grokACP/bin/grok-acp.mjs status \
  --cwd /home/desk/dev/repos/zq

node /home/desk/dev/repos/grokACP/bin/grok-acp.mjs status \
  --cwd /home/desk/dev/repos/zq \
  --session-id 019ef5b1-bf1a-75e1-b215-02bb482bb335 \
  --json
```

`status` reads Grok's local session files under `~/.grok/sessions/<encoded-cwd>/<session-id>/`, primarily `signals.json`, `summary.json`, and `updates.jsonl`. It reports context tokens, context window size, usage percentage, compaction count, last compaction event, model, and a PM recommendation.

Send a follow-up prompt to an existing session:

```bash
node /home/desk/dev/repos/grokACP/bin/grok-acp.mjs run \
  --cwd /home/desk/dev/repos/zq \
  --session-id <session-id> \
  --prompt-file <task.md>
```

Compact an existing session:

```bash
node /home/desk/dev/repos/grokACP/bin/grok-acp.mjs compact \
  --cwd /home/desk/dev/repos/zq \
  --session-id <session-id> \
  --context "保留当前任务目标、已修改文件、验收命令和未解决风险"
```

`compact` sends the official `/compact [context]` slash command through ACP and records context status before and after. If a normal PM task does not require continuity, prefer `new` or default fresh-session `run` instead of compacting.

## Output Contract

Each run writes two files:

```text
<out-dir>/<北京时间戳>-<name>.md
<out-dir>/<北京时间戳>-<name>.json
```

The Markdown report is for PM reading. The JSON report is for automation.

Both include:

- Beijing creation time
- model
- cwd
- prompt source
- ACP session id
- stop reason
- auth method
- Grok reply text
- stderr

## Authentication

The tool follows the official headless example:

1. Send `initialize`.
2. Prefer `xai.api_key` when `XAI_API_KEY` exists and the server offers it.
3. Otherwise use `cached_token`.
4. If neither is available, run `grok login` first or set `XAI_API_KEY`.

## PM Usage Rules

- Default to one fresh session per task. This avoids context drift and removes most context-window management.
- Put task scope, forbidden scope, acceptance command, and final report requirements in the prompt file.
- Trust Grok execution for fast and ordinary standard tasks; PM performs final key-risk review.
- Use longer-lived sessions only when continuity is valuable. Check `status` before dispatch, continue with `--session-id`, and compact with `compact` once the PM threshold is reached.
