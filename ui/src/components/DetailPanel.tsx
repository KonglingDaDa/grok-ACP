import { useEffect, useRef, useState } from 'react'
import { ThroughputChart } from './ThroughputChart'
import { ContextChip } from './ContextChip'
import { OutputStream } from './OutputStream'
import { StatusLed, STATUS_WORD, ledColor } from './status/StatusLed'
import { formatCount, formatDateTime, formatElapsed } from '../lib/format'
import { gsap, motionSafe, useGSAP } from '../lib/motion'
import type { Sample, TaskMeta } from '../lib/types'

export interface DetailPanelProps {
  task: TaskMeta | null
  samples: Sample[]
  demo: boolean
  onClose: () => void
  ensureSamples: (id: string) => void
}

const PROMPT_COLLAPSE_LINES = 8

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="mono-label truncate text-xs" style={{ color: 'var(--color-muted)' }}>
        {label}
      </dt>
      <dd className="truncate text-xs" style={{ color: 'var(--color-neutral)' }} title={value}>
        {value}
      </dd>
    </>
  )
}

/** Centered modal dialog (§4.5, v2.1) — GSAP budget item #3, Esc/mask close, hash sync owned by App. */
export function DetailPanel({ task, samples, demo, onClose, ensureSamples }: DetailPanelProps) {
  const open = task !== null
  const [mounted, setMounted] = useState(false)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [cache, setCache] = useState<{ task: TaskMeta; samples: Sample[] } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const maskRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (task) {
      setCache({ task, samples })
    }
  }, [task, samples])

  useEffect(() => {
    if (open) {
      setMounted(true)
      setPromptExpanded(false)
    }
  }, [open, task?.id])

  useEffect(() => {
    if (task) ensureSamples(task.id)
  }, [task, ensureSamples])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useGSAP(
    () => {
      if (!mounted) return
      const panel = panelRef.current
      const mask = maskRef.current
      if (!panel || !mask) return

      if (open) {
        motionSafe(
          () => {
            gsap.fromTo(mask, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.26, ease: 'token-ease-out' })
            gsap.fromTo(
              panel,
              { scale: 0.96, autoAlpha: 0, y: 12, transformOrigin: '50% 50%' },
              { scale: 1, autoAlpha: 1, y: 0, duration: 0.26, ease: 'token-ease-out' },
            )
          },
          () => {
            gsap.fromTo([mask, panel], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.15, ease: 'token-ease-out' })
          },
        )
      } else {
        motionSafe(
          () => {
            gsap.to(mask, { autoAlpha: 0, duration: 0.26, ease: 'token-ease-out' })
            gsap.to(panel, {
              scale: 0.96,
              autoAlpha: 0,
              y: 12,
              duration: 0.26,
              ease: 'token-ease-out',
              onComplete: () => setMounted(false),
            })
          },
          () => {
            gsap.to([mask, panel], {
              autoAlpha: 0,
              duration: 0.15,
              ease: 'token-ease-out',
              onComplete: () => setMounted(false),
            })
          },
        )
      }
    },
    { scope: panelRef, dependencies: [open, mounted] },
  )

  if (!mounted || !cache) return null

  const activeTask = cache.task
  const activeSamples = cache.samples
  const status = activeTask.effectiveStatus
  const promptBody = activeTask.prompt ?? activeTask.promptPreview ?? ''
  const promptLines = promptBody.split('\n')
  const promptIsLong = promptLines.length > PROMPT_COLLAPSE_LINES
  const promptShown =
    promptExpanded || !promptIsLong ? promptBody : promptLines.slice(0, PROMPT_COLLAPSE_LINES).join('\n')

  return (
    <>
      <div
        ref={maskRef}
        className="panel-mask fixed inset-0"
        style={{ zIndex: 'var(--z-panel)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-md"
        style={{ zIndex: 'var(--z-panel)', pointerEvents: 'none' }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${activeTask.name} detail`}
          className="flex flex-col p-md custom-scrollbar"
          style={{
            pointerEvents: 'auto',
            width: 'min(960px, 94vw)',
            maxHeight: 'min(88vh, 1000px)',
            overflowY: 'auto',
            background: 'var(--color-paper-2)',
            border: 'var(--rule-card) solid var(--color-rule)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-hover)',
          }}
        >
        <div className="flex items-start justify-between gap-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-sm">
            <StatusLed status={status} />
            <span
              className="truncate text-lg"
              style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-display)', fontWeight: 600 }}
            >
              {activeTask.name}
            </span>
            <span
              className="mono-label text-xs"
              style={{ color: ledColor(status), fontFamily: 'var(--font-display)', fontWeight: 600 }}
            >
              {STATUS_WORD[status]}
            </span>
            <span className="mono-label text-xs" style={{ color: 'var(--color-muted)' }}>
              {activeTask.model}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mono-label shrink-0 px-xs py-2xs text-xs"
            style={{
              border: '1px solid var(--color-rule-2)',
              borderRadius: 'var(--radius-pill)',
              color: 'var(--color-muted)',
              background: 'transparent',
            }}
          >
            ✕ 关闭
          </button>
        </div>
        <div className="mono-label mt-2xs text-xs" style={{ color: 'var(--color-muted)' }}>
          开始 {formatDateTime(activeTask.startedAt)} <span aria-hidden="true">·</span> 结束{' '}
          {formatDateTime(activeTask.endedAt)}
        </div>

        <div className="mt-md">
          <ThroughputChart samples={activeSamples} mode="full" live={status === 'running'} />
        </div>

        <dl className="mt-lg grid grid-cols-[auto_1fr] gap-x-md gap-y-2xs md:grid-cols-[auto_1fr_auto_1fr]">
          <MetaRow label="任务ID" value={activeTask.id} />
          <MetaRow label="会话ID" value={activeTask.sessionId ?? '—'} />
          <MetaRow label="目标目录" value={activeTask.targetCwd} />
          <MetaRow label="发起目录" value={activeTask.invokerCwd} />
          <MetaRow label="报告路径" value={activeTask.reportPath ?? '—'} />
          <MetaRow label="JSON路径" value={activeTask.jsonPath ?? '—'} />
          <MetaRow label="累计输出" value={formatCount(activeTask.tokensOut)} />
          <MetaRow
            label="累计消耗"
            value={
              typeof activeTask.context?.consumedTokens === 'number'
                ? formatCount(activeTask.context.consumedTokens)
                : '—'
            }
          />
          <MetaRow label="压缩次数" value={activeTask.context ? String(activeTask.context.compactionCount ?? 0) : '—'} />
          <MetaRow label="耗时" value={activeTask.durationMs !== null ? formatElapsed(activeTask.durationMs) : '—'} />
          <MetaRow
            label="上下文"
            value={
              activeTask.context
                ? `${
                    Number.isFinite(activeTask.context.usagePct)
                      ? `${Math.round(activeTask.context.usagePct!)}%`
                      : '—'
                  } · ${
                    activeTask.context.totalTokens != null
                      ? activeTask.context.totalTokens.toLocaleString()
                      : '—'
                  }${
                    activeTask.context.windowTokens
                      ? ` / ${activeTask.context.windowTokens.toLocaleString()}`
                      : ''
                  } tokens`
                : '—'
            }
          />
        </dl>
        {activeTask.context && (
          <div className="mt-xs">
            <ContextChip context={activeTask.context} />
          </div>
        )}
        {status === 'error' && activeTask.error && (
          <div className="mt-sm text-xs" style={{ color: 'var(--color-down)' }}>
            {activeTask.error}
          </div>
        )}

        <section className="mt-lg">
          <h3 className="mono-label mb-xs text-xs" style={{ color: 'var(--color-muted)' }}>
            提示词
          </h3>
          <pre
            className="whitespace-pre-wrap break-words p-sm text-sm"
            style={{
              background: 'var(--color-paper-3)',
              border: `var(--rule-card) solid var(--color-rule)`,
              borderRadius: 'var(--radius-card)',
              color: 'var(--color-neutral)',
            }}
          >
            {promptShown}
          </pre>
          {promptIsLong && (
            <button
              type="button"
              onClick={() => setPromptExpanded((v) => !v)}
              className="mono-label mt-2xs px-xs py-2xs text-xs"
              style={{
                border: '1px solid var(--color-rule-2)',
                borderRadius: 'var(--radius-pill)',
                color: 'var(--color-muted)',
                background: 'transparent',
              }}
            >
              {promptExpanded ? '收起' : '显示全部'}
            </button>
          )}
        </section>

        <section className="mb-md mt-lg">
          <OutputStream taskId={activeTask.id} demo={demo} resultStart={activeTask.resultStart ?? null} />
        </section>
        </div>
      </div>
    </>
  )
}
