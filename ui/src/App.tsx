import { useEffect, useMemo, useState } from 'react'
import { TopBar } from './components/TopBar'
import { RepoTabs } from './components/RepoTabs'
import { TaskGrid } from './components/TaskGrid'
import { StatusBar } from './components/StatusBar'
import { DetailPanel } from './components/DetailPanel'
import { EmptyState } from './components/EmptyState'
import { deleteTaskWithFade } from './lib/task-delete'
import { useMonitorStore } from './lib/store'
import { ALL_REPO_KEY, buildGrid, buildRepoTabs, countRunning, countStartedToday } from './lib/selectors'

const HASH_PREFIX = '#task='

function readTaskIdFromHash(): string | null {
  const hash = window.location.hash
  if (!hash.startsWith(HASH_PREFIX)) return null
  const id = decodeURIComponent(hash.slice(HASH_PREFIX.length))
  return id || null
}

/**
 * Top-level composition (§4.3). Owns repo-tab selection and the selected-task id, keeping
 * the id in sync with `#task=<id>` so the detail panel is refreshable/linkable directly
 * (back/forward via `hashchange`, deep link via initial read on mount).
 */
export default function App() {
  const demo = useMemo(() => new URLSearchParams(window.location.search).has('demo'), [])
  const { state, ensureSamples, removeTask, markRemoving, clearRemoving } = useMonitorStore(demo)
  const [selectedRepo, setSelectedRepo] = useState(ALL_REPO_KEY)
  const [selectedId, setSelectedId] = useState<string | null>(() => readTaskIdFromHash())

  useEffect(() => {
    function onHashChange() {
      setSelectedId(readTaskIdFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const target = selectedId ? `${HASH_PREFIX}${encodeURIComponent(selectedId)}` : ''
    if (window.location.hash === target) return
    const url = window.location.pathname + window.location.search + target
    window.history.replaceState(null, '', url)
  }, [selectedId])

  const tasks = useMemo(() => Array.from(state.tasks.values()), [state.tasks])
  const repoTabs = useMemo(() => buildRepoTabs(tasks), [tasks])
  const grid = useMemo(() => buildGrid(tasks, selectedRepo), [tasks, selectedRepo])
  const runningCount = useMemo(() => countRunning(tasks), [tasks])
  const todayCount = useMemo(() => countStartedToday(tasks), [tasks])

  const selectedTask = selectedId ? (state.tasks.get(selectedId) ?? null) : null
  const selectedSamples = selectedId ? (state.samples.get(selectedId) ?? []) : []
  const isEmpty = state.loaded && tasks.length === 0
  const finishedCount = grid.compact.length

  useEffect(() => {
    if (selectedId && !state.tasks.has(selectedId)) {
      setSelectedId(null)
    }
  }, [selectedId, state.tasks])

  async function handleClearFinished() {
    if (finishedCount === 0) return
    if (!window.confirm(`确认删除 ${finishedCount} 个已结束任务？`)) return
    for (const task of grid.compact) {
      try {
        await deleteTaskWithFade(task.id, { demo, removeTask, markRemoving, clearRemoving })
      } catch (err) {
        console.error(err)
      }
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar runningCount={runningCount} todayCount={todayCount} connection={state.connection} demo={demo} />
      <RepoTabs
        tabs={repoTabs}
        selected={selectedRepo}
        onSelect={setSelectedRepo}
        trailing={
          finishedCount > 0 ? (
            <button
              type="button"
              onClick={handleClearFinished}
              className="mono-label shrink-0 px-xs py-2xs text-xs clear-finished-btn"
              style={{
                border: '1px solid var(--color-down)',
                borderRadius: 'var(--radius-pill)',
                color: 'var(--color-down)',
                background: 'oklch(65% 0.19 25 / 0.08)',
              }}
            >
              清理已结束 ({finishedCount})
            </button>
          ) : undefined
        }
      />
      <main className="flex-1">
        {isEmpty ? (
          <EmptyState />
        ) : (
          <TaskGrid
            grid={grid}
            samples={state.samples}
            demo={demo}
            onOpen={setSelectedId}
            ensureSamples={ensureSamples}
            removeTask={removeTask}
            markRemoving={markRemoving}
            clearRemoving={clearRemoving}
          />
        )}
      </main>
      <StatusBar runningCount={runningCount} todayCount={todayCount} />
      <DetailPanel
        task={selectedTask}
        samples={selectedSamples}
        demo={demo}
        onClose={() => setSelectedId(null)}
        ensureSamples={ensureSamples}
      />
    </div>
  )
}
