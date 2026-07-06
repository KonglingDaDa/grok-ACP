/** §4.8 — no illustration, just mono text. Honest copy: no fabricated numbers. */
export function EmptyState() {
  return (
    <div
      className="flex min-h-[40vh] flex-col items-center justify-center gap-xs px-md text-center"
      style={{ borderRadius: 'var(--radius-card)' }}
    >
      <p className="mono-label text-sm" style={{ color: 'var(--color-neutral)' }}>
        等待首个任务调度
      </p>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        grok-acp run --prompt-text "…" 触发后此处实时出现
      </p>
    </div>
  )
}
