import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { basename } from '../../lib/format'
import { STATUS_WORD } from '../status/StatusLed'
import type { EffectiveStatus, Sample, TaskMeta } from '../../lib/types'

/** 标签弱灰 + 数值提亮加重 —— 卡片信息行的统一层级语言。 */
export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-2xs whitespace-nowrap">
      <span style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span style={{ color: 'var(--color-ink-2)', fontWeight: 500 }}>{value}</span>
    </span>
  )
}

export function FooterMeta({ task }: { task: TaskMeta }) {
  return (
    <div className="mono-label mt-sm truncate text-xs" style={{ color: 'var(--color-muted)' }}>
      <span style={{ color: 'var(--color-neutral)' }}>{basename(task.targetCwd)}</span>
      <span aria-hidden="true"> · </span>来自: {basename(task.invokerCwd)}
    </div>
  )
}

interface CardShellProps {
  task: TaskMeta
  status: EffectiveStatus
  onOpen: (id: string) => void
  className: string
  children: ReactNode
  cardRef: RefObject<HTMLElement>
  flashRef: RefObject<HTMLDivElement>
}

/**
 * Shared clickable card frame: base 1px rule border (`.task-card` in index.css handles hover
 * glow), a 2px accent/down left stripe for running/error (§4.4), and the state-flip flash
 * overlay target (GSAP budget item #2, driven by the parent TaskCard).
 */
export function CardShell({ task, status, onOpen, className, children, cardRef, flashRef }: CardShellProps) {
  const accentLeft = status === 'running'
  const downLeft = status === 'error'
  const isRunning = status === 'running'

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(task.id)
    }
  }

  return (
    <article
      ref={cardRef}
      data-card-id={task.id}
      className={`task-card relative ${isRunning ? 'p-lg' : 'p-md'} ${className}`}
      style={{
        borderRadius: 'var(--radius-card)',
        background: isRunning ? 'var(--color-paper-3)' : 'var(--color-paper-2)',
        ...(accentLeft || downLeft
          ? { borderLeftWidth: 2, borderLeftColor: accentLeft ? 'var(--color-up)' : 'var(--color-down)' }
          : {}),
        ...(accentLeft ? { boxShadow: 'var(--shadow-card), var(--glow-live)' } : {}),
      }}
      tabIndex={0}
      role="button"
      aria-label={`${task.name}, ${STATUS_WORD[status]}`}
      onClick={() => onOpen(task.id)}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={flashRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ border: '2px solid var(--color-up)', opacity: 0 }}
      />
      {children}
    </article>
  )
}

export interface VariantProps {
  task: TaskMeta
  samples: Sample[]
  demo: boolean
  onOpen: (id: string) => void
  ensureSamples: (id: string) => void
  removeTask: (id: string) => void
  markRemoving: (id: string) => void
  clearRemoving: (id: string) => void
  cardRef: RefObject<HTMLElement>
  flashRef: RefObject<HTMLDivElement>
}