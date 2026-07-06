import { useEffect, useRef, useState } from 'react'
import { fetchOutputChunk } from '../lib/api'
import { demoFetchOutputChunk } from '../lib/demo'
import { renderBody } from './markdown/renderMarkdown'

export interface OutputStreamProps {
  taskId: string
  demo: boolean
  resultStart?: number | null
}

const POLL_MS = 1000

/** Polls /api/tasks/:id/output (or the demo equivalent) at 1s; server reports `done` from effectiveStatus. */
export function OutputStream({ taskId, demo, resultStart }: OutputStreamProps) {
  const [text, setText] = useState('')
  const [follow, setFollow] = useState(true)
  const [done, setDone] = useState(false)
  const nextRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    setText('')
    setFollow(true)
    setDone(false)
    nextRef.current = 0
    doneRef.current = false
    let disposed = false

    async function poll() {
      if (disposed || doneRef.current) return
      try {
        const chunk = demo
          ? await demoFetchOutputChunk(taskId, nextRef.current)
          : await fetchOutputChunk(taskId, nextRef.current)
        if (disposed) return
        if (chunk.text) setText((t) => t + chunk.text)
        nextRef.current = chunk.next
        doneRef.current = chunk.done
        if (chunk.done) setDone(true)
      } catch {
        // transient — next tick retries
      }
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      disposed = true
      clearInterval(id)
    }
  }, [taskId, demo])

  useEffect(() => {
    if (!follow) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text, follow])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setFollow(atBottom)
  }

  const rs = typeof resultStart === 'number' ? resultStart : null
  const splitActive = rs !== null && rs > 0
  const boundary = splitActive ? Math.min(rs, text.length) : 0
  const processText = splitActive ? text.slice(0, boundary) : rs === 0 && done ? '' : text
  const resultText = splitActive ? text.slice(boundary).replace(/^\n+/, '') : rs === 0 && done ? text : ''

  return (
    <div>
      <div className="mono-label mb-xs flex items-center justify-between text-xs" style={{ color: 'var(--color-muted)' }}>
        <span>输出</span>
        <button
          type="button"
          onClick={() => setFollow((f) => !f)}
          aria-pressed={follow}
          className="px-xs py-2xs"
          style={{
            border: `1px solid ${follow ? 'var(--color-up)' : 'var(--color-rule-2)'}`,
            borderRadius: 'var(--radius-pill)',
            color: follow ? 'var(--color-up)' : 'var(--color-muted)',
            background: 'transparent',
          }}
        >
          自动跟随 {follow ? '开' : '关'}
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[55vh] overflow-y-auto p-sm text-sm"
        style={{
          background: 'var(--color-paper-3)',
          border: `var(--rule-card) solid var(--color-rule)`,
          borderRadius: 'var(--radius-card)',
          lineHeight: 1.7,
          color: 'var(--color-neutral)',
        }}
      >
        {text ? (
          <>
            {processText && (
              <section>
                {(splitActive || resultText) && (
                  <div className="mono-label mb-2xs text-xs" style={{ color: 'var(--color-muted)' }}>
                    执行过程
                  </div>
                )}
                <div style={splitActive ? { opacity: 0.78 } : undefined}>{renderBody(processText)}</div>
              </section>
            )}
            {resultText && (
              <section className={processText ? 'mt-md' : undefined}>
                <div className="mono-label mb-2xs text-xs" style={{ color: 'var(--color-up)' }}>
                  最终结果
                </div>
                <div
                  className="p-sm"
                  style={{
                    background: 'var(--color-up-tint)',
                    border: '1px solid var(--color-up-tint-border)',
                    borderRadius: 'var(--radius-card)',
                  }}
                >
                  {renderBody(resultText)}
                </div>
              </section>
            )}
          </>
        ) : (
          <span style={{ color: 'var(--color-muted)' }}>—</span>
        )}
      </div>
    </div>
  )
}