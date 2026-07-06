import { useRef } from 'react'
import type { ConnectionState } from '../lib/api'
import { gsap, motionSafe, useGSAP } from '../lib/motion'

export interface TopBarProps {
  runningCount: number
  todayCount: number
  connection: ConnectionState
  demo: boolean
}

/** Nav prototype N6 — split-level command bar, 44px, sticky (§4.3.1). */
export function TopBar({ runningCount, todayCount, connection, demo }: TopBarProps) {
  const headerRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      motionSafe(
        () => {
          gsap.from(headerRef.current, {
            y: -44,
            autoAlpha: 0,
            duration: 0.15,
            ease: 'token-ease-out',
          })
        },
        () => {
          gsap.from(headerRef.current, { autoAlpha: 0, duration: 0.1 })
        },
      )
    },
    { scope: headerRef },
  )

  const live = connection === 'live'
  return (
    <header
      ref={headerRef}
      className="mono-label sticky top-0 flex items-center justify-between gap-md px-md text-xs"
      style={{
        height: 44,
        borderBottom: '1px solid var(--color-rule)',
        background: 'var(--color-paper)',
        zIndex: 'var(--z-sticky-nav)',
      }}
    >
      {/* 左：品牌 */}
      <div
        className="flex items-center gap-xs"
        style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        <span>GROK ACP</span>
        <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>
          ▮
        </span>
        <span style={{ color: 'var(--color-neutral)', fontWeight: 500 }}>监控</span>
        {demo && (
          <span
            className="ml-sm px-xs text-xs"
            style={{
              border: '1px solid var(--color-warn)',
              borderRadius: 'var(--radius-pill)',
              color: 'var(--color-warn)',
            }}
          >
            演示数据
          </span>
        )}
      </div>

      {/* 中：主指标（运行中任务） */}
      <div
        className="flex items-center gap-2xs"
        style={{
          color: runningCount > 0 ? 'var(--color-up)' : 'var(--color-muted)',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 'var(--text-sm)',
        }}
      >
        <span
          aria-hidden="true"
          className={runningCount > 0 ? 'led-running' : ''}
          data-led-delay={runningCount > 0 ? '1' : undefined}
        >
          ●
        </span>
        <span>{runningCount} 运行中</span>
      </div>

      {/* 右：次要指标 */}
      <div className="flex items-center gap-md">
        <span
          className="flex items-center gap-2xs"
          style={{ color: live ? 'var(--color-up)' : 'var(--color-warn)' }}
          title={live ? '已连接' : '重连中'}
        >
          <span
            aria-hidden="true"
            className={live ? '' : 'led-running'}
            data-led-delay={live ? undefined : '2'}
          >
            ●
          </span>
          {live ? '在线' : '重连中'}
        </span>
        <span style={{ color: 'var(--color-muted)' }}>今日 {todayCount}</span>
      </div>
    </header>
  )
}