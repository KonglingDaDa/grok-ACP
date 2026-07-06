import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { RepoTab } from '../lib/selectors'
import { gsap, motionSafe, useGSAP } from '../lib/motion'

export interface RepoTabsProps {
  tabs: RepoTab[]
  selected: string
  onSelect: (key: string) => void
  trailing?: ReactNode
}

/** §4.3.2 — ALL + auto-aggregated targetCwd tabs, sorted by recent activity, GSAP underline on select. */
export function RepoTabs({ tabs, selected, onSelect, trailing }: RepoTabsProps) {
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])
  const indicatorRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    const selectedIdx = tabs.findIndex((t) => t.key === selected)
    if (selectedIdx === -1) return

    const targetTab = tabsRef.current[selectedIdx]
    const indicator = indicatorRef.current
    if (!targetTab || !indicator) return

    gsap.set(indicator, {
      x: targetTab.offsetLeft,
      width: targetTab.offsetWidth,
    })
    initializedRef.current = true
  }, [])

  useGSAP(
    () => {
      const selectedIdx = tabs.findIndex((t) => t.key === selected)
      if (selectedIdx === -1) return

      const targetTab = tabsRef.current[selectedIdx]
      const indicator = indicatorRef.current
      if (!targetTab || !indicator) return

      const { offsetLeft, offsetWidth } = targetTab

      if (!initializedRef.current) {
        gsap.set(indicator, { x: offsetLeft, width: offsetWidth })
        initializedRef.current = true
        return
      }

      motionSafe(
        () => {
          gsap.to(indicator, {
            x: offsetLeft,
            width: offsetWidth,
            duration: 0.3,
            ease: 'token-ease-out',
          })
        },
        () => {
          gsap.set(indicator, { x: offsetLeft, width: offsetWidth })
        },
      )
    },
    { scope: containerRef, dependencies: [selected, tabs] },
  )

  return (
    <nav
      className="mono-label flex items-center justify-between gap-md px-md text-xs"
      style={{ borderBottom: '1px solid var(--color-rule)', background: 'var(--color-paper)' }}
      aria-label="repository filter"
    >
      <div
        ref={containerRef}
        className="relative flex min-w-0 flex-1 items-center gap-md overflow-x-auto"
      >
        {tabs.map((tab, idx) => {
          const isSelected = tab.key === selected
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabsRef.current[idx] = el
              }}
              type="button"
              onClick={() => onSelect(tab.key)}
              title={tab.title}
              aria-pressed={isSelected}
              className="flex shrink-0 items-center gap-2xs whitespace-nowrap py-sm"
              style={{
                color: isSelected ? 'var(--color-ink)' : 'var(--color-muted)',
                borderRadius: 'var(--radius-pill)',
                background: 'transparent',
              }}
            >
              {tab.label}
              {tab.runningCount > 0 && (
                <span style={{ color: 'var(--color-up)' }}>{tab.runningCount}</span>
              )}
            </button>
          )
        })}
        <div
          ref={indicatorRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: 2,
            background: 'var(--color-accent)',
            pointerEvents: 'none',
            willChange: 'transform, width',
          }}
        />
      </div>
      {trailing}
    </nav>
  )
}