import { formatCount } from '../lib/format'
import type { ContextLevel, TaskContext } from '../lib/types'

const LEVEL_WORD: Record<ContextLevel, string> = {
  ok: '正常',
  watch: '注意',
  medium: '中等',
  high: '偏高',
  critical: '严重',
}

function getContextStyle(level: ContextLevel | null) {
  switch (level) {
    case 'ok':
      return {
        background: 'var(--color-up-tint)',
        border: '1px solid var(--color-up-tint-border)',
        color: 'var(--color-up)',
      }
    case 'watch':
      return {
        background: 'oklch(77% 0.140 85 / 0.07)',
        border: '1px solid oklch(77% 0.140 85 / 0.22)',
        color: 'var(--color-warn)',
      }
    case 'medium':
      return {
        background: 'oklch(77% 0.140 85 / 0.12)',
        border: '1px solid oklch(77% 0.140 85 / 0.30)',
        color: 'var(--color-warn)',
      }
    case 'high':
      return {
        background: 'oklch(65% 0.190 25 / 0.12)',
        border: '1px solid oklch(65% 0.190 25 / 0.30)',
        color: 'var(--color-down)',
      }
    case 'critical':
      return {
        background: 'oklch(58% 0.210 25 / 0.15)',
        border: '1px solid var(--color-crit)',
        color: 'var(--color-crit)',
      }
    default:
      return {
        background: 'transparent',
        border: '1px solid var(--color-rule-2)',
        color: 'var(--color-muted)',
      }
  }
}

/** Grok 会话上下文 chip：占用百分比 + 已用/窗口总长，等级用颜色区分，tooltip 给完整解释。 */
export function ContextChip({ context }: { context: TaskContext | null }) {
  if (!context) return null
  const level = context.level ?? 'ok'
  const pct = Number.isFinite(context.usagePct) ? `${Math.round(context.usagePct!)}%` : '—'
  const style = getContextStyle(level)
  const window = context.windowTokens
  const usedLabel =
    context.totalTokens != null
      ? window
        ? `${formatCount(context.totalTokens)}/${formatCount(window)}`
        : formatCount(context.totalTokens)
      : '—'

  return (
    <span
      className="mono-label inline-flex shrink-0 items-center px-xs py-2xs text-xs leading-[1.6]"
      style={{
        ...style,
        borderRadius: 'var(--radius-pill)',
      }}
      title={`Grok 会话上下文：已用 ${
        context.totalTokens != null ? context.totalTokens.toLocaleString() : '—'
      } tokens${window ? `，窗口总长 ${window.toLocaleString()} tokens` : ''}，占用 ${pct}${
        level ? ` · 等级：${LEVEL_WORD[level] ?? level}` : ''
      }`}
    >
      上下文 {pct} · {usedLabel}
    </span>
  )
}