import { useRef } from 'react'
import { TaskCard } from './TaskCard'
import { gsap, motionSafe, useGSAP } from '../lib/motion'
import type { GridBuckets } from '../lib/selectors'
import type { Sample, TaskMeta } from '../lib/types'

export interface TaskGridProps {
  grid: GridBuckets
  samples: Map<string, Sample[]>
  demo: boolean
  onOpen: (id: string) => void
  ensureSamples: (id: string) => void
  removeTask: (id: string) => void
  markRemoving: (id: string) => void
  clearRemoving: (id: string) => void
}

/**
 * Bento-grid dashboard body (§4.3) — running cards first (2-up), then compact terminal
 * cards (4-up), same `TaskCard` component/instance per task.id across both buckets so a
 * running->terminal move is a React update, never an unmount/remount (see TaskCard.tsx).
 *
 * GSAP animation budget item #1 (§4.7): new cards enter with autoAlpha+y stagger. A
 * `seenIds` ref diffs the current id list against everything animated so far — every id is
 * "new" on the very first paint (intentional: first paint should stagger in), but a later
 * full-refresh re-delivery of already-seen ids must not replay.
 */
export function TaskGrid({
  grid,
  samples,
  demo,
  onOpen,
  ensureSamples,
  removeTask,
  markRemoving,
  clearRemoving,
}: TaskGridProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const seenIds = useRef<Set<string>>(new Set())
  const ordered: TaskMeta[] = [...grid.running, ...grid.compact]
  const idKey = ordered.map((t) => t.id).join(',')

  useGSAP(
    () => {
      const container = gridRef.current
      if (!container) return
      const newEls: Element[] = []
      container.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
        const id = el.dataset.cardId
        if (!id || seenIds.current.has(id)) return
        seenIds.current.add(id)
        newEls.push(el)
      })
      if (newEls.length === 0) return
      motionSafe(
        () => {
          gsap.from(newEls, { autoAlpha: 0, y: 8, duration: 0.3, stagger: 0.08, ease: 'token-ease-out' })
        },
        () => {
          gsap.from(newEls, { autoAlpha: 0, duration: 0.15 })
        },
      )
    },
    { scope: gridRef, dependencies: [idKey] },
  )

  return (
    <div ref={gridRef} className="grid grid-cols-12 gap-md p-md">
      {ordered.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          samples={samples.get(task.id) ?? []}
          demo={demo}
          onOpen={onOpen}
          ensureSamples={ensureSamples}
          removeTask={removeTask}
          markRemoving={markRemoving}
          clearRemoving={clearRemoving}
        />
      ))}
    </div>
  )
}
