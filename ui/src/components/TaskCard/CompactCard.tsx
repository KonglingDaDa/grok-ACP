import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { ThroughputChart } from '../ThroughputChart'
import { ContextChip } from '../ContextChip'
import { StatusLed } from '../status/StatusLed'
import { deleteTaskWithFade } from '../../lib/task-delete'
import { formatCardTime, formatCount, formatElapsed, shortModel } from '../../lib/format'
import { CardShell, FooterMeta, Metric, type VariantProps } from './CardShell'

function DeleteButton({
  task,
  demo,
  removeTask,
  markRemoving,
  clearRemoving,
}: Pick<VariantProps, 'task' | 'demo' | 'removeTask' | 'markRemoving' | 'clearRemoving'>) {
  async function handleDelete(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (!window.confirm(`确认删除任务「${task.name}」？删除后记录不可恢复。`)) return
    try {
      await deleteTaskWithFade(task.id, { demo, removeTask, markRemoving, clearRemoving })
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <button
      type="button"
      aria-label="删除任务"
      className="task-card-delete mono-label absolute right-md top-md px-2xs py-2xs text-xs leading-none"
      style={{
        color: 'var(--color-muted)',
        borderRadius: 'var(--radius-pill)',
        background: 'transparent',
        border: 'none',
      }}
      onClick={handleDelete}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      ✕
    </button>
  )
}

/** done / error / interrupted — compact card, viewport-gated sample load (§4.2, §4.4). */
export function CompactCard({
  task,
  samples,
  demo,
  onOpen,
  ensureSamples,
  removeTask,
  markRemoving,
  clearRemoving,
  cardRef,
  flashRef,
}: VariantProps) {
  const status = task.effectiveStatus
  const observeRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = observeRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: '80px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (inView) ensureSamples(task.id)
  }, [inView, task.id, ensureSamples])

  return (
    <CardShell
      task={task}
      status={status}
      onOpen={onOpen}
      cardRef={cardRef}
      flashRef={flashRef}
      className="col-span-12 md:col-span-6 xl:col-span-3"
    >
      <DeleteButton
        task={task}
        demo={demo}
        removeTask={removeTask}
        markRemoving={markRemoving}
        clearRemoving={clearRemoving}
      />
      <div ref={observeRef}>
        <div className="flex items-center gap-xs">
          <StatusLed status={status} />
          <span
            className="truncate text-sm"
            style={{ color: 'var(--color-ink-2)', fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            {task.name}
          </span>
        </div>

        {status === 'done' && (
          <div className="mono-label mt-2xs text-xs">
            <Metric label="耗时" value={formatElapsed(task.durationMs ?? 0)} />
          </div>
        )}
        {status === 'error' && (
          <div className="mt-2xs truncate text-xs" style={{ color: 'var(--color-down)' }} title={task.error ?? ''}>
            {(task.error ?? '').split('\n')[0]}
          </div>
        )}
        {status === 'interrupted' && (
          <div className="mono-label mt-2xs text-xs" style={{ color: 'var(--color-warn)' }}>
            已中断
          </div>
        )}

        <div className="mt-sm">
          {inView ? (
            <ThroughputChart samples={samples} mode="mini" live={false} height={64} />
          ) : (
            <div style={{ height: 64 }} />
          )}
        </div>
        <div className="mono-label mt-sm flex flex-wrap items-center gap-x-md gap-y-2xs text-xs">
          <Metric label="启动" value={formatCardTime(task.startedAt)} />
          <span
            className="truncate px-xs"
            title={task.model}
            style={{
              color: 'var(--color-neutral)',
              border: '1px solid var(--color-rule-2)',
              borderRadius: 'var(--radius-pill)',
              lineHeight: 1.6,
            }}
          >
            {shortModel(task.model)}
          </span>
        </div>
        <div className="mono-label mt-2xs flex flex-wrap items-center gap-x-md gap-y-2xs text-xs">
          <span className="inline-flex"><Metric label="累计输出" value={formatCount(task.tokensOut)} /></span>
          {typeof task.context?.consumedTokens === 'number' && (
            <span className="inline-flex"><Metric label="累计消耗" value={formatCount(task.context.consumedTokens)} /></span>
          )}
          {(task.context?.compactionCount ?? 0) > 0 && (
            <span
              className="mono-label inline-flex shrink-0 items-center px-xs text-xs leading-[1.6]"
              style={{
                border: '1px solid var(--color-warn)',
                borderRadius: 'var(--radius-pill)',
                color: 'var(--color-warn)',
              }}
              title={`该会话上下文被压缩过 ${task.context?.compactionCount} 次；累计消耗已包含压缩前的全部 token`}
            >
              压缩 ×{task.context?.compactionCount}
            </span>
          )}
          <ContextChip context={task.context} />
        </div>
        <FooterMeta task={task} />
      </div>
    </CardShell>
  )
}