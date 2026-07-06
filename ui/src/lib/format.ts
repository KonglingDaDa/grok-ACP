// Presentation-only helpers. No business logic (effectiveStatus derivation stays server-side).

export function basename(p: string): string {
  const clean = p.replace(/\/+$/, '')
  const idx = clean.lastIndexOf('/')
  return idx === -1 ? clean : clean.slice(idx + 1) || clean
}

/**
 * Compact thousands formatting for token counts.
 *
 * Examples:
 * - 12400 → "12.4k"
 * - 200000 → "200k"（自动去掉无意义的 .0）
 * - 1500000 → "1.5m"
 *
 * @param n - Token count or any numeric value
 * @returns Formatted string with k/m suffix; returns "0" for NaN/Infinity
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}m`
}

export function formatTps(n: number): string {
  if (!Number.isFinite(n)) return '0.0'
  return n.toFixed(1)
}

/** mm:ss for durations under an hour, hh:mm:ss beyond. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatClockTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toTimeString().slice(0, 8)
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return iso.replace('T', ' ').replace(/\+\d\d:\d\d$/, '')
}

/**
 * Format ISO 8601 timestamp to MM-DD HH:mm for task cards.
 *
 * Example: "2026-07-04T15:30:45+08:00" → "07-04 15:30"
 *
 * @param iso - ISO 8601 string or null
 * @returns Formatted string; returns "—" for null or invalid input
 */
export function formatCardTime(iso: string | null): string {
  if (!iso) return '—'
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return '—'
  return `${m[1]}-${m[2]} ${m[3]}:${m[4]}`
}

/**
 * Remove "grok-" prefix from model names for compact display.
 *
 * Example: "grok-composer-2.5-fast" → "composer-2.5-fast"
 *
 * @param model - Full model name
 * @returns Model name without "grok-" prefix
 */
export function shortModel(model: string): string {
  return model.replace(/^grok-/, '')
}
