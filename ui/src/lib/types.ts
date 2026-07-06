// Shapes mirror docs/monitor-ui-design.md §2 (data schema) and §3.4 (API/SSE contract).
// This file is the only place the frontend defines these shapes — do not redeclare elsewhere.

export type TaskCommand = 'run' | 'compact'

/** Status as persisted in meta.json. Server never persists "interrupted". */
export type TaskStatus = 'running' | 'done' | 'error'

/** status, plus the server-derived "interrupted" (stale heartbeat / dead pid). */
export type EffectiveStatus = TaskStatus | 'interrupted'

export type ContextLevel = 'ok' | 'watch' | 'medium' | 'high' | 'critical'

export interface TaskContext {
  level: ContextLevel | null
  totalTokens: number | null
  usagePct: number | null
  windowTokens?: number | null
  consumedTokens?: number | null
  compactionCount?: number
}

export interface TaskMeta {
  id: string
  name: string
  command: TaskCommand
  status: TaskStatus
  /** Server-derived status (list, SSE, and detail always include this; authoritative for interrupted). */
  effectiveStatus: EffectiveStatus
  /** Omitted on /api/tasks and SSE task events; present on GET /api/tasks/:id meta. */
  prompt?: string
  promptPreview: string
  model: string
  targetCwd: string
  invokerCwd: string
  sessionId: string | null
  pid: number
  startedAt: string
  endedAt: string | null
  heartbeatAt: string
  tokensOut: number
  chars: number
  /** Distinct tool calls so far (live during running). Optional: absent on pre-feature meta.json. */
  toolCallCount?: number
  durationMs: number | null
  context: TaskContext | null
  resultStart?: number | null
  reportPath: string | null
  jsonPath: string | null
  error: string | null
}

/** [epochMs, tokensPerSecondThisBucket, cumulativeTokens] */
export type Sample = [number, number, number]

export interface TaskDetail {
  meta: TaskMeta
  samples: Sample[]
}

export interface OutputChunkResponse {
  text: string
  next: number
  done: boolean
}

export interface TasksResponse {
  tasks: TaskMeta[]
}
