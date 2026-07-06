import type { OutputChunkResponse, TaskDetail, TaskMeta, TasksResponse } from './types'

// Thin fetch wrappers over the contract in docs/monitor-ui-design.md §3.4.
// Dev proxy (/api -> 127.0.0.1:41730) is configured in vite.config.ts; in production
// the same origin serves both the SPA and the API, so relative paths work everywhere.

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}`)
  }
  return (await res.json()) as T
}

export async function fetchTasks(): Promise<TaskMeta[]> {
  const data = await getJson<TasksResponse>('/api/tasks')
  return data.tasks
}

export async function fetchTaskDetail(id: string): Promise<TaskDetail> {
  return getJson<TaskDetail>(`/api/tasks/${encodeURIComponent(id)}`)
}

export async function fetchOutputChunk(id: string, from: number): Promise<OutputChunkResponse> {
  return getJson<OutputChunkResponse>(
    `/api/tasks/${encodeURIComponent(id)}/output?from=${encodeURIComponent(String(from))}`,
  )
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) {
    let message = String(res.status)
    try {
      const body = (await res.json()) as { error?: string }
      if (typeof body.error === 'string') message = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message)
  }
}

export type ConnectionState = 'live' | 'reconnecting'

export interface EventStreamHandlers {
  onTask: (task: TaskMeta) => void
  onSample: (id: string, t: number, tps: number, cum: number) => void
  onDeleted: (id: string) => void
  onConnectionChange: (state: ConnectionState) => void
  /** Fired on (re)connect — the caller should refetch /api/tasks to calibrate. */
  onCalibrate: () => void
}

/** Opens /api/events (SSE) and wires the three event kinds from §3.4. Returns a disposer. */
export function connectEventStream(handlers: EventStreamHandlers): () => void {
  const es = new EventSource('/api/events')
  let everOpened = false

  es.addEventListener('hello', () => {
    everOpened = true
    handlers.onConnectionChange('live')
    handlers.onCalibrate()
  })

  es.addEventListener('task', (evt) => {
    try {
      const task = JSON.parse((evt as MessageEvent).data) as TaskMeta
      handlers.onTask(task)
    } catch {
      // malformed event — ignore, next event will self-correct
    }
  })

  es.addEventListener('sample', (evt) => {
    try {
      const sample = JSON.parse((evt as MessageEvent).data) as {
        id: string
        t: number
        tps: number
        cum: number
      }
      handlers.onSample(sample.id, sample.t, sample.tps, sample.cum)
    } catch {
      // malformed event — ignore
    }
  })

  es.addEventListener('deleted', (evt) => {
    try {
      const payload = JSON.parse((evt as MessageEvent).data) as { id: string }
      if (payload.id) handlers.onDeleted(payload.id)
    } catch {
      // malformed event — ignore
    }
  })

  es.onopen = () => {
    handlers.onConnectionChange('live')
    if (everOpened) {
      // reconnect after a drop — recalibrate full task list
      handlers.onCalibrate()
    }
  }

  es.onerror = () => {
    handlers.onConnectionChange('reconnecting')
  }

  return () => es.close()
}
