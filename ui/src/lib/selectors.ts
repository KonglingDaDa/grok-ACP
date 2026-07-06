import { basename } from './format'
import type { TaskMeta } from './types'

export interface RepoTab {
  key: string
  label: string
  title: string
  runningCount: number
  lastActivity: number
}

const ALL_KEY = '__all__'

function activityTime(task: TaskMeta): number {
  const end = task.endedAt ? Date.parse(task.endedAt) : NaN
  const start = Date.parse(task.startedAt)
  const heartbeat = Date.parse(task.heartbeatAt)
  return Math.max(
    Number.isNaN(end) ? -Infinity : end,
    Number.isNaN(start) ? -Infinity : start,
    Number.isNaN(heartbeat) ? -Infinity : heartbeat,
  )
}

export function buildRepoTabs(tasks: TaskMeta[]): RepoTab[] {
  const byRepo = new Map<string, RepoTab>()
  for (const task of tasks) {
    const key = task.targetCwd
    const running = task.effectiveStatus === 'running'
    const activity = activityTime(task)
    const existing = byRepo.get(key)
    if (existing) {
      existing.runningCount += running ? 1 : 0
      existing.lastActivity = Math.max(existing.lastActivity, activity)
    } else {
      byRepo.set(key, {
        key,
        label: basename(key) || key,
        title: key,
        runningCount: running ? 1 : 0,
        lastActivity: activity,
      })
    }
  }
  const repos = Array.from(byRepo.values()).sort((a, b) => b.lastActivity - a.lastActivity)
  const allRunning = repos.reduce((sum, r) => sum + r.runningCount, 0)
  const allActivity = repos.reduce((max, r) => Math.max(max, r.lastActivity), -Infinity)
  return [
    { key: ALL_KEY, label: '全部', title: '所有仓库', runningCount: allRunning, lastActivity: allActivity },
    ...repos,
  ]
}

export const ALL_REPO_KEY = ALL_KEY

export interface GridBuckets {
  running: TaskMeta[]
  compact: TaskMeta[]
}

export function buildGrid(tasks: TaskMeta[], selectedRepo: string): GridBuckets {
  const scoped = selectedRepo === ALL_KEY ? tasks : tasks.filter((t) => t.targetCwd === selectedRepo)
  const running: TaskMeta[] = []
  const compact: TaskMeta[] = []
  for (const task of scoped) {
    if (task.effectiveStatus === 'running') running.push(task)
    else compact.push(task)
  }
  running.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  compact.sort((a, b) => {
    const ea = a.endedAt ? Date.parse(a.endedAt) : Date.parse(a.startedAt)
    const eb = b.endedAt ? Date.parse(b.endedAt) : Date.parse(b.startedAt)
    return eb - ea
  })
  return { running, compact }
}

export function countRunning(tasks: TaskMeta[]): number {
  return tasks.reduce((sum, t) => sum + (t.effectiveStatus === 'running' ? 1 : 0), 0)
}

export function countStartedToday(tasks: TaskMeta[]): number {
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  return tasks.reduce((sum, t) => {
    const dt = new Date(t.startedAt)
    if (Number.isNaN(dt.getTime())) return sum
    return sum + (dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d ? 1 : 0)
  }, 0)
}
