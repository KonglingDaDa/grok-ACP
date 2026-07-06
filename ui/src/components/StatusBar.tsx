import { useRef } from 'react'
import { gsap, motionSafe, useGSAP } from '../lib/motion'

const VERSION = '0.2.0'

export interface StatusBarProps {
  runningCount: number
  todayCount: number
}

/** Footer prototype Ft6 — stat bar with live metrics (§4.3.4). */
export function StatusBar({ runningCount, todayCount }: StatusBarProps) {
  const footerRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      motionSafe(
        () => {
          gsap.from(footerRef.current, {
            y: 36,
            autoAlpha: 0,
            duration: 0.15,
            delay: 0.4,
            ease: 'token-ease-out',
          })
        },
        () => {
          gsap.from(footerRef.current, { autoAlpha: 0, duration: 0.1 })
        },
      )
    },
    { scope: footerRef },
  )

  return (
    <footer
      ref={footerRef}
      className="mono-label flex items-center justify-between px-md text-xs"
      style={{
        height: 36,
        borderTop: '1px solid var(--color-rule)',
        color: 'var(--color-muted)',
        background: 'var(--color-paper)',
      }}
    >
      {/* 左：数据源信息 */}
      <div className="flex items-center gap-xs">
        <span>~/.grok-acp</span>
        <span aria-hidden="true">·</span>
        <span>保留 7 天</span>
      </div>

      {/* 右：实时统计 */}
      <div className="flex items-center gap-xs">
        <span style={{ color: runningCount > 0 ? 'var(--color-up)' : 'var(--color-muted)' }}>
          {runningCount} 运行
        </span>
        <span aria-hidden="true">·</span>
        <span>{todayCount} 今日</span>
        <span aria-hidden="true">·</span>
        <span>v{VERSION}</span>
      </div>
    </footer>
  )
}