import { useEffect, useMemo, useRef, useState } from 'react'
import type { Sample } from '../lib/types'
import { formatTps } from '../lib/format'
import { gsap, motionSafe } from '../lib/motion'

export interface ThroughputChartProps {
  samples: Sample[]
  mode: 'mini' | 'full'
  live?: boolean
  /** Overrides the mode-default height (running mini=72px vs done/error/interrupted mini=64px, §4.4). */
  height?: number
}

interface PlotMap {
  t0: number
  tSpan: number
  padLeft: number
  plotW: number
  padTop: number
  plotH: number
  dispMax: number
}

interface HoverState {
  x: number
  y: number
  sample: Sample
  time: string
}

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Turns a resolved `oklch(L C H)` token string into `oklch(L C H / alpha)` for gradient stops. */
function withAlpha(color: string, alpha: number): string {
  if (color.includes('/')) return color
  return color.replace(/\)\s*$/, ` / ${alpha})`)
}

function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function nearestIndex(samples: Sample[], t: number): number {
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid][0] < t) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(samples[lo - 1][0] - t) < Math.abs(samples[lo][0] - t)) return lo - 1
  return lo
}

/** Canvas-drawn throughput chart — the only chart component (§4.6). Redraws on new samples / resize only. */
export function ThroughputChart({ samples, mode, live = false, height: heightOverride }: ThroughputChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const displayMaxRef = useRef(1)
  const animRef = useRef<{ from: number; to: number; start: number } | null>(null)
  const rafRef = useRef<number | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const plotRef = useRef<PlotMap | null>(null)
  const hoverRef = useRef<HoverState | null>(null)
  const [hoveredPoint, setHoveredPoint] = useState<HoverState | null>(null)

  const height = heightOverride ?? (mode === 'mini' ? 72 : 240)

  const scheduleDraw = useMemo(() => {
    return () => {
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        drawRef.current()
      })
    }
  }, [])

  function showTooltip(point: HoverState) {
    const tooltip = tooltipRef.current
    if (!tooltip) return
    motionSafe(
      () => {
        gsap.to(tooltip, {
          autoAlpha: 1,
          x: point.x,
          y: point.y - 30,
          duration: 0.15,
          ease: 'token-ease-out',
        })
      },
      () => {
        gsap.set(tooltip, { autoAlpha: 1, x: point.x, y: point.y - 30 })
      },
    )
  }

  function hideTooltip() {
    const tooltip = tooltipRef.current
    if (!tooltip) return
    motionSafe(
      () => {
        gsap.to(tooltip, {
          autoAlpha: 0,
          duration: 0.1,
          ease: 'token-ease-out',
        })
      },
      () => {
        gsap.set(tooltip, { autoAlpha: 0 })
      },
    )
  }

  function draw() {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || document.hidden) return

    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (samples.length === 0) return

    const rawMax = Math.max(1, Math.max(...samples.map((s) => s[1])) * 1.15)
    const now = performance.now()
    let dispMax = displayMaxRef.current
    const anim = animRef.current
    if (anim) {
      const t = Math.min(1, (now - anim.start) / 200)
      dispMax = anim.from + (anim.to - anim.from) * t
      if (t >= 1) {
        displayMaxRef.current = anim.to
        animRef.current = null
      }
    } else if (Math.abs(rawMax - displayMaxRef.current) > 0.05) {
      animRef.current = { from: displayMaxRef.current, to: rawMax, start: now }
      dispMax = displayMaxRef.current
    }
    if (animRef.current) scheduleDraw()

    const t0 = samples[0][0]
    const t1 = samples[samples.length - 1][0]
    const tSpan = Math.max(1000, t1 - t0)
    const padLeft = 2
    const padRight = live ? (mode === 'full' ? 58 : 32) : mode === 'full' ? 34 : 2
    const padTop = 6
    const padBottom = mode === 'full' ? 18 : 2
    const plotW = Math.max(1, width - padLeft - padRight)
    const plotH = Math.max(1, height - padTop - padBottom)
    plotRef.current = { t0, tSpan, padLeft, plotW, padTop, plotH, dispMax }

    const xFor = (t: number) => padLeft + ((t - t0) / tSpan) * plotW
    const yFor = (v: number) => padTop + plotH - (Math.min(v, dispMax) / dispMax) * plotH

    const ruleColor = readVar('--color-rule')
    const mutedColor = readVar('--color-muted')
    const accent = readVar('--color-accent')
    const fontMono = readVar('--font-mono')

    // horizontal grid hairlines
    ctx.strokeStyle = ruleColor
    ctx.lineWidth = 1
    const gridLines = mode === 'full' ? 4 : 3
    for (let i = 0; i <= gridLines; i += 1) {
      const y = Math.round(padTop + (plotH / gridLines) * i) + 0.5
      ctx.beginPath()
      ctx.moveTo(padLeft, y)
      ctx.lineTo(padLeft + plotW, y)
      ctx.stroke()
    }

    // area fill — the one allowed gradient (dataviz use, §6)
    ctx.beginPath()
    ctx.moveTo(xFor(samples[0][0]), yFor(samples[0][1]))
    for (const s of samples) ctx.lineTo(xFor(s[0]), yFor(s[1]))
    ctx.lineTo(xFor(samples[samples.length - 1][0]), padTop + plotH)
    ctx.lineTo(xFor(samples[0][0]), padTop + plotH)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH)
    grad.addColorStop(0, withAlpha(accent, 0.08))
    grad.addColorStop(1, withAlpha(accent, 0))
    ctx.fillStyle = grad
    ctx.fill()

    // line
    ctx.beginPath()
    ctx.moveTo(xFor(samples[0][0]), yFor(samples[0][1]))
    for (const s of samples) ctx.lineTo(xFor(s[0]), yFor(s[1]))
    ctx.strokeStyle = accent
    ctx.lineWidth = mode === 'mini' ? 1 : 1.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()

    // full-mode axis ticks
    if (mode === 'full') {
      ctx.fillStyle = mutedColor
      ctx.font = `10px ${fontMono}`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      for (let i = 0; i <= gridLines; i += 1) {
        const v = dispMax - (dispMax / gridLines) * i
        const y = padTop + (plotH / gridLines) * i
        ctx.fillText(formatTps(v), padLeft + plotW + 6, y)
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const xTicks = 5
      for (let i = 0; i <= xTicks; i += 1) {
        const t = t0 + (tSpan / xTicks) * i
        ctx.fillText(formatMmSs(t - t0), xFor(t), padTop + plotH + 4)
      }
    }

    // live current-value marker — market-ticker current price tag
    if (live) {
      const last = samples[samples.length - 1]
      const lx = xFor(last[0])
      const ly = yFor(last[1])
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(lx, ly, 3, 0, Math.PI * 2)
      ctx.fill()

      const label = formatTps(last[1])
      ctx.font = `${mode === 'full' ? 11 : 10}px ${fontMono}`
      const labelW = ctx.measureText(label).width + 8
      const labelX = width - labelW - 2
      const labelY = Math.max(padTop, Math.min(padTop + plotH - 14, ly - 7))
      ctx.fillStyle = accent
      ctx.fillRect(labelX, labelY, labelW, 14)
      ctx.fillStyle = readVar('--color-paper')
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, labelX + labelW / 2, labelY + 7)
    }

    // hover crosshair — full mode only
    const hover = hoverRef.current
    if (hover && mode === 'full') {
      const hx = hover.x
      const hy = hover.y
      ctx.save()
      ctx.strokeStyle = mutedColor
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(hx, padTop)
      ctx.lineTo(hx, padTop + plotH)
      ctx.moveTo(padLeft, hy)
      ctx.lineTo(padLeft + plotW, hy)
      ctx.stroke()
      ctx.restore()
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(hx, hy, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawRef.current = draw

  useEffect(() => {
    scheduleDraw()
  }, [samples, mode, live, scheduleDraw])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => scheduleDraw())
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) scheduleDraw()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  function resolveHoverPoint(mouseX: number): HoverState | null {
    if (samples.length === 0) return null
    const plot = plotRef.current
    if (!plot) return null
    const t = plot.t0 + ((mouseX - plot.padLeft) / plot.plotW) * plot.tSpan
    const idx = nearestIndex(samples, t)
    const sample = samples[idx]
    const x = plot.padLeft + ((sample[0] - plot.t0) / plot.tSpan) * plot.plotW
    const y = plot.padTop + plot.plotH - (Math.min(sample[1], plot.dispMax) / plot.dispMax) * plot.plotH
    return {
      x,
      y,
      sample,
      time: formatMmSs(sample[0] - samples[0][0]),
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (samples.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    if (!plotRef.current) drawRef.current()
    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const point = resolveHoverPoint(mouseX)
    if (!point) return
    hoverRef.current = point
    setHoveredPoint(point)
    showTooltip(point)
    scheduleDraw()
  }

  function handleMouseLeave() {
    hoverRef.current = null
    setHoveredPoint(null)
    hideTooltip()
    scheduleDraw()
  }

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Token 吞吐速率图，共 ${samples.length} 个采样点`}
        onMouseMove={samples.length > 0 ? handleMouseMove : undefined}
        onMouseLeave={samples.length > 0 ? handleMouseLeave : undefined}
        className="block w-full"
        style={{ height, cursor: samples.length > 0 ? 'pointer' : undefined }}
      />
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute text-xs"
        style={{
          opacity: 0,
          visibility: 'hidden',
          background: 'var(--color-paper-3)',
          border: '1px solid var(--color-rule)',
          borderRadius: 'var(--radius-card)',
          padding: 'var(--space-2xs) var(--space-xs)',
          color: 'var(--color-ink)',
          whiteSpace: 'nowrap',
          zIndex: 'var(--z-tooltip)',
        }}
      >
        {hoveredPoint && (
          <>
            <div>{hoveredPoint.time}</div>
            <div style={{ color: 'var(--color-up)', fontWeight: 600 }}>
              {formatTps(hoveredPoint.sample[1])} TPS
            </div>
          </>
        )}
      </div>
    </div>
  )
}