import { useRef } from 'react'
import { gsap, motionSafe, useGSAP } from '../../lib/motion'
import type { EffectiveStatus, Sample, TaskMeta } from '../../lib/types'
import { CompactCard } from './CompactCard'
import { RunningCard } from './RunningCard'

export interface TaskCardProps {
  task: TaskMeta
  samples: Sample[]
  demo: boolean
  onOpen: (id: string) => void
  ensureSamples: (id: string) => void
  removeTask: (id: string) => void
  markRemoving: (id: string) => void
  clearRemoving: (id: string) => void
}

/**
 * Single component for all four states (§4.4) so a running->terminal transition is a
 * re-render of the same instance (key={task.id} stable across TaskGrid's bucket move),
 * letting the GSAP state-flip flash (budget item #2, §4.7) observe the previous status.
 */
export function TaskCard({
  task,
  samples,
  demo,
  onOpen,
  ensureSamples,
  removeTask,
  markRemoving,
  clearRemoving,
}: TaskCardProps) {
  const status = task.effectiveStatus
  const cardRef = useRef<HTMLElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const prevStatusRef = useRef<EffectiveStatus | null>(null)

  useGSAP(
    () => {
      const prev = prevStatusRef.current
      prevStatusRef.current = status
      const flipped = prev === 'running' && (status === 'done' || status === 'error')
      const el = flashRef.current
      if (!flipped || !el) return
      motionSafe(
        () => {
          gsap.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.3, ease: 'token-ease-out' })
        },
        () => {
          gsap.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.15, ease: 'token-ease-out' })
        },
      )
    },
    { scope: cardRef, dependencies: [status] },
  )

  if (status === 'running') {
    return (
      <RunningCard
        task={task}
        samples={samples}
        demo={demo}
        onOpen={onOpen}
        ensureSamples={ensureSamples}
        removeTask={removeTask}
        markRemoving={markRemoving}
        clearRemoving={clearRemoving}
        cardRef={cardRef}
        flashRef={flashRef}
      />
    )
  }
  return (
    <CompactCard
      task={task}
      samples={samples}
      demo={demo}
      onOpen={onOpen}
      ensureSamples={ensureSamples}
      removeTask={removeTask}
      markRemoving={markRemoving}
      clearRemoving={clearRemoving}
      cardRef={cardRef}
      flashRef={flashRef}
    />
  )
}