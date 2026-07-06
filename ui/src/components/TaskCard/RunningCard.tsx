import { useEffect, useState } from 'react'
import { ThroughputChart } from '../ThroughputChart'
import { ContextChip } from '../ContextChip'
import { StatusLed } from '../status/StatusLed'
import { formatCardTime, formatCount, formatElapsed, formatTps } from '../../lib/format'
import { CardShell, FooterMeta, Metric, type VariantProps } from './CardShell'

/** running — big card, immediate sample load, live mini chart, ticking ELAPSED (§4.4). */
export function RunningCard({ task, samples, onOpen, ensureSamples, cardRef, flashRef }: VariantProps) {
  const [, forceTick] = useState(0)

  useEffect(() => {
    ensureSamples(task.id)
  }, [task.id, ensureSamples])

  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const elapsedMs = Date.now() - Date.parse(task.startedAt)
  const last = samples[samples.length - 1]
  const currentTps = last ? last[1] : 0

  return (
    <CardShell
      task={task}
      status="running"
      onOpen={onOpen}
      cardRef={cardRef}
      flashRef={flashRef}
      className="col-span-12 md:col-span-6 xl:col-span-6"
    >
      <div className="flex items-center gap-xs">
        <StatusLed status="running" />
        <span
          className="truncate text-base"
          style={{ color: 'var(--color-ink-2)', fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          {task.name}
        </span>
        <span className="mono-label shrink-0 text-xs" style={{ color: 'var(--color-muted)' }}>
          {task.model}
        </span>
      </div>
      <p className="mt-xs line-clamp-2 text-sm" style={{ color: 'var(--color-neutral)' }}>
        {task.promptPreview}
      </p>
      <div className="mt-sm">
        <ThroughputChart samples={samples} mode="mini" live />
      </div>
      <div className="mono-label mt-sm flex flex-wrap items-center gap-md text-xs" style={{ color: 'var(--color-muted)' }}>
        <span>
          速率{' '}
          <b className="text-lg" style={{ color: 'var(--color-ink)', fontWeight: 500 }}>
            {formatTps(currentTps)}
          </b>
        </span>
        <Metric label="累计输出" value={formatCount(task.tokensOut)} />
        <Metric label="工具调用" value={formatCount(task.toolCallCount ?? 0)} />
        <Metric label="耗时" value={formatElapsed(elapsedMs)} />
        <Metric label="启动" value={formatCardTime(task.startedAt)} />
        {task.context ? (
          <ContextChip context={task.context} />
        ) : (
          <span
            className="mono-label inline-flex shrink-0 items-center px-xs py-2xs text-xs leading-[1.6]"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-rule-2)',
              color: 'var(--color-muted)',
              borderRadius: 'var(--radius-pill)',
            }}
            title="上下文用量与压缩次数由 Grok 在跑完当前 prompt 后才落盘，运行中暂不可得"
          >
            上下文 · 完成后可见
          </span>
        )}
      </div>
      <FooterMeta task={task} />
    </CardShell>
  )
}