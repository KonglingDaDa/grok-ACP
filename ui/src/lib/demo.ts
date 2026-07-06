import type { MonitorDispatch } from './store'
import type { OutputChunkResponse, Sample, TaskMeta } from './types'

// Pure frontend synthetic data for `?demo` — no network requests (§4.2).
// 5 tasks / 2 repos / 1 running (random walk) / 2 done / 1 error / 1 interrupted.

const REPO_ZQ = '/home/desk/dev/repos/zq'
const REPO_PM = '/home/desk/dev/pm-project'
const MODEL = 'grok-composer-2.5-fast'

function isoAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString()
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** Random walk with occasional dips to 0 — the stall visual the design calls for (§2.3). */
function walkSamples(startEpochMs: number, count: number, opts?: { seedTps?: number }): Sample[] {
  const samples: Sample[] = []
  let tps = opts?.seedTps ?? randRange(24, 46)
  let cum = 0
  for (let i = 0; i < count; i += 1) {
    const stall = Math.random() < 0.08
    if (stall) {
      tps = 0
    } else {
      tps = Math.max(0, Math.min(96, tps + randRange(-9, 9)))
    }
    cum += tps
    samples.push([startEpochMs + i * 1000, Math.round(tps * 10) / 10, Math.round(cum)])
  }
  return samples
}

const PROMPT_AUDIT = `审计 src/rate-limiter.ts 的令牌桶实现：确认并发请求下不会出现计数漂移，检查 Redis 连接失败时的降级路径是否会误放行超额请求。补齐边界用例的单元测试，不要改动对外 API 签名。完成后总结现有实现的两个潜在风险点。`

const PROMPT_REFACTOR = `把 src/middleware/auth.ts 里混在一起的 JWT 校验和会话续期逻辑拆成两个独立函数，保持行为完全一致，补充必要注释。跑一下现有测试确认没有回归。`

const PROMPT_README = `更新 README.md 顶部的徽标区块：把 build/coverage badge 换成当前 CI 的 shields.io 链接，并检查其余链接是否失效。`

const PROMPT_FLAKY = `定位 tests/integration/session.test.ts 里偶发失败的用例，怀疑是会话过期时间的竞态问题，给出根因分析和修复建议。`

const PROMPT_MIGRATE = `评估把构建工具从 webpack 5 迁移到 vite 的改动范围：列出需要调整的配置项、别名解析差异、以及对现有 CI 产物路径的影响，暂不动代码，先出评估报告。`

function outputFor(kind: 'audit' | 'refactor' | 'readme' | 'flaky' | 'migrate'): string {
  switch (kind) {
    case 'audit':
      return `已通读 \`rate-limiter.ts\`。令牌桶的 refill 计算使用 \`Date.now()\` 差值乘速率，多个请求并发进入时存在竞态窗口：\n\n\`\`\`ts\n// 当前实现 —— 两次 now() 之间没有锁\nconst elapsed = now() - bucket.lastRefill\nbucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.rate)\nbucket.lastRefill = now()\n\`\`\`\n\n风险点一：Redis 不可用时 \`catch\` 分支直接 \`return true\`（放行），在流量高峰期这是危险默认值。\n风险点二：\`bucket.tokens\` 的读改写不是原子操作，高并发下会出现多计一次 refill。\n\n已补充 3 个边界用例（并发刷新、Redis 超时降级、容量为 0），全部通过。建议后续把降级策略改为拒绝而非放行，并加 mutex 保护 refill。`
    case 'refactor':
      return `已将 \`auth.ts\` 拆分为 \`verifyJwt()\` 和 \`renewSession()\` 两个纯函数，原 \`authenticate()\` 中间件现在只做编排：\n\n\`\`\`ts\nexport function authenticate(req, res, next) {\n  const claims = verifyJwt(req.headers.authorization)\n  renewSession(claims, res)\n  next()\n}\n\`\`\`\n\n跑了 \`npm test\`，42 个用例全部通过，行为无变化。`
    case 'readme':
      return `已将 build badge 指向 \`https://github.com/org/pm-project/actions/workflows/ci.yml/badge.svg\`，coverage badge 指向 codecov 项目页。检查了其余 6 个链接，均可访问，无需改动。`
    case 'flaky':
      return `复现了 12 次，失败率约 25%。根因：测试里创建的 session 用固定 \`Date.now() + 1000\` 作为过期时间，而 CI 机器在负载高时单个用例耗时可能超过 1s，导致校验时 session 已经过期。\n\n建议修复：改用注入的假时钟（已有 \`FakeClock\` 工具类）而不是真实系统时间，避免测试对执行速度产生依赖。`
    case 'migrate':
      return `评估结论：改动集中在三处。\n\n\`\`\`text\n1. 别名解析：webpack resolve.alias -> vite resolve.alias，路径写法一致，可直接迁移\n2. 环境变量前缀：process.env.REACT_APP_* -> import.meta.env.VITE_*，需要全仓库替换\n3. CI 产物路径：build/ -> dist/，发布脚本里有 4 处硬编码路径需要同步\n\`\`\`\n\n未发现阻塞性障碍，工作量预估 0.5 人日，建议先在分支上跑通再合入。`
  }
}

interface DemoTaskSpec {
  id: string
  name: string
  status: TaskMeta['status']
  effectiveStatus: TaskMeta['effectiveStatus']
  targetCwd: string
  invokerCwd: string
  prompt: string
  startedAgoSec: number
  endedAgoSec: number | null
  sampleSeconds: number
  outputKind: 'audit' | 'refactor' | 'readme' | 'flaky' | 'migrate'
  context: TaskMeta['context']
  error: string | null
  sessionId: string | null
}

function stamp(offsetSec: number): string {
  const d = new Date(Date.now() - offsetSec * 1000)
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
}

const SPECS: DemoTaskSpec[] = [
  {
    id: `${stamp(210)}-demo-a1`,
    name: 'audit-rate-limit',
    status: 'running',
    effectiveStatus: 'running',
    targetCwd: REPO_ZQ,
    invokerCwd: REPO_PM,
    prompt: PROMPT_AUDIT,
    startedAgoSec: 210,
    endedAgoSec: null,
    sampleSeconds: 60,
    outputKind: 'audit',
    context: null,
    error: null,
    sessionId: 'sess_demo_a1f9',
  },
  {
    id: `${stamp(1800)}-demo-b2`,
    name: 'refactor-auth-middleware',
    status: 'done',
    effectiveStatus: 'done',
    targetCwd: REPO_ZQ,
    invokerCwd: REPO_PM,
    prompt: PROMPT_REFACTOR,
    startedAgoSec: 1800,
    endedAgoSec: 1614,
    sampleSeconds: 186,
    outputKind: 'refactor',
    context: { level: 'ok', totalTokens: 42300, usagePct: 24 },
    error: null,
    sessionId: 'sess_demo_b2c4',
  },
  {
    id: `${stamp(5400)}-demo-c3`,
    name: 'update-readme-badges',
    status: 'done',
    effectiveStatus: 'done',
    targetCwd: REPO_PM,
    invokerCwd: REPO_PM,
    prompt: PROMPT_README,
    startedAgoSec: 5400,
    endedAgoSec: 5352,
    sampleSeconds: 48,
    outputKind: 'readme',
    context: { level: 'watch', totalTokens: 104200, usagePct: 61 },
    error: null,
    sessionId: 'sess_demo_c3d1',
  },
  {
    id: `${stamp(3000)}-demo-d4`,
    name: 'flaky-test-investigation',
    status: 'error',
    effectiveStatus: 'error',
    targetCwd: REPO_ZQ,
    invokerCwd: REPO_PM,
    prompt: PROMPT_FLAKY,
    startedAgoSec: 3000,
    endedAgoSec: 2932,
    sampleSeconds: 68,
    outputKind: 'flaky',
    context: null,
    error: 'ACP session timed out after 120000ms',
    sessionId: 'sess_demo_d4e2',
  },
  {
    id: `${stamp(900)}-demo-e5`,
    name: 'migrate-webpack-to-vite',
    status: 'running',
    effectiveStatus: 'interrupted',
    targetCwd: REPO_PM,
    invokerCwd: REPO_PM,
    prompt: PROMPT_MIGRATE,
    startedAgoSec: 900,
    endedAgoSec: null,
    sampleSeconds: 41,
    outputKind: 'migrate',
    context: null,
    error: null,
    sessionId: 'sess_demo_e5f7',
  },
]

interface DemoOutputState {
  full: string
  revealed: number
  done: boolean
}

const demoOutputs = new Map<string, DemoOutputState>()
const runningSpecId = SPECS.find((s) => s.effectiveStatus === 'running')?.id ?? null

function buildTaskMeta(spec: DemoTaskSpec): TaskMeta {
  const startedAt = isoAgo(spec.startedAgoSec)
  const endedAt = spec.endedAgoSec === null ? null : isoAgo(spec.endedAgoSec)
  const heartbeatAt =
    spec.effectiveStatus === 'interrupted' ? isoAgo(30) : spec.effectiveStatus === 'running' ? isoAgo(1) : startedAt
  const durationMs =
    spec.endedAgoSec === null ? null : (spec.startedAgoSec - spec.endedAgoSec) * 1000
  return {
    id: spec.id,
    name: spec.name,
    command: 'run',
    status: spec.status,
    effectiveStatus: spec.effectiveStatus,
    prompt: spec.prompt,
    promptPreview: spec.prompt.slice(0, 160),
    model: MODEL,
    targetCwd: spec.targetCwd,
    invokerCwd: spec.invokerCwd,
    sessionId: spec.sessionId,
    pid: 40000 + Math.floor(Math.random() * 9000),
    startedAt,
    endedAt,
    heartbeatAt,
    tokensOut: 0,
    chars: 0,
    toolCallCount: spec.effectiveStatus === 'running' ? 4 : 0,
    durationMs,
    context: spec.context,
    reportPath: spec.endedAgoSec === null ? null : `.codex-artifacts/grok-acp-runs/${spec.name}.md`,
    jsonPath: spec.endedAgoSec === null ? null : `.codex-artifacts/grok-acp-runs/${spec.name}.json`,
    error: spec.error,
  }
}

/** Seeds the store with 5 tasks + full sample history, then ticks the running task forever. */
export function runDemoEngine(dispatch: MonitorDispatch): () => void {
  const tasks: TaskMeta[] = []

  for (const spec of SPECS) {
    const meta = buildTaskMeta(spec)
    const startMs = Date.parse(meta.startedAt)
    const samples = walkSamples(startMs, spec.sampleSeconds)
    const lastSample = samples[samples.length - 1]
    meta.tokensOut = lastSample ? lastSample[2] : 0
    meta.chars = Math.round(meta.tokensOut * 3.4)
    tasks.push(meta)
    dispatch({ type: 'samples/set', id: meta.id, samples })

    const full = outputFor(spec.outputKind)
    const isLiveRunning = spec.id === runningSpecId
    demoOutputs.set(meta.id, {
      full,
      revealed: isLiveRunning ? Math.floor(full.length * 0.55) : full.length,
      done: !isLiveRunning,
    })
  }

  dispatch({ type: 'tasks/set', tasks })

  if (!runningSpecId) return () => {}

  const runningMeta = tasks.find((t) => t.id === runningSpecId)!
  let cum = runningMeta.tokensOut
  let tps = randRange(24, 46)

  const interval = setInterval(() => {
    const stall = Math.random() < 0.08
    tps = stall ? 0 : Math.max(0, Math.min(96, tps + randRange(-9, 9)))
    cum += tps
    const t = Date.now()
    dispatch({ type: 'sample/add', id: runningSpecId, sample: [t, Math.round(tps * 10) / 10, Math.round(cum)] })

    const out = demoOutputs.get(runningSpecId)
    if (out && out.revealed < out.full.length) {
      out.revealed = Math.min(out.full.length, out.revealed + Math.floor(randRange(6, 22)))
    }

    dispatch({
      type: 'task/upsert',
      task: {
        ...runningMeta,
        tokensOut: Math.round(cum),
        chars: Math.round(cum * 3.4),
        heartbeatAt: new Date(t).toISOString(),
      },
    })
  }, 1000)

  return () => clearInterval(interval)
}

/** Mirrors GET /api/tasks/:id/output?from= for demo tasks — no network. */
export async function demoFetchOutputChunk(id: string, from: number): Promise<OutputChunkResponse> {
  const out = demoOutputs.get(id)
  if (!out) return { text: '', next: from, done: true }
  const text = out.full.slice(from, out.revealed)
  return { text, next: out.revealed, done: out.done }
}

export function isDemoTaskId(id: string): boolean {
  return demoOutputs.has(id)
}
