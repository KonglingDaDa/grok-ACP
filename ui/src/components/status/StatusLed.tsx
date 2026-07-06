import { useMemo } from 'react'
import type { EffectiveStatus } from '../../lib/types'

export const STATUS_WORD: Record<EffectiveStatus, string> = {
  running: '运行中',
  done: '完成',
  error: '错误',
  interrupted: '中断',
}

export function ledColor(status: EffectiveStatus): string {
  if (status === 'running') return 'var(--color-up)'
  if (status === 'error') return 'var(--color-down)'
  if (status === 'interrupted') return 'var(--color-warn)'
  return 'var(--color-muted)'
}

/** Exported for reuse in DetailPanel's title row — single source of truth for LED color/pulse. */
export function StatusLed({ status }: { status: EffectiveStatus }) {
  const delayId = useMemo(() => Math.floor(Math.random() * 6) + 1, [])

  return (
    <span
      aria-hidden="true"
      className={status === 'running' ? 'led-running' : ''}
      data-led-delay={status === 'running' ? String(delayId) : undefined}
      style={{ color: ledColor(status), fontSize: '0.7em', lineHeight: 1 }}
    >
      ●
    </span>
  )
}