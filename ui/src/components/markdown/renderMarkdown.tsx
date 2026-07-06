import type { ReactNode } from 'react'

/** 行内解析：`code` 与 **bold**，其余原样输出 */
export function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) {
      out.push(
        <code
          key={`${keyBase}-c${i}`}
          style={{
            fontFamily: 'var(--font-mono)',
            background: 'var(--color-paper)',
            borderRadius: 4,
            padding: '0 4px',
            color: 'var(--color-ink-2)',
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      )
    } else {
      out.push(
        <b key={`${keyBase}-b${i}`} style={{ color: 'var(--color-ink)', fontWeight: 600 }}>
          {tok.slice(2, -2)}
        </b>,
      )
    }
    last = m.index + tok.length
    i += 1
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** 尝试把一行解析为表格行（"| a | b |"），不是则返回 null。不处理转义竖线 \|。 */
export function parseTableRow(line: string): string[] | null {
  const t = line.trim()
  if (!t.startsWith('|')) return null
  const inner = t.replace(/^\|/, '').replace(/\|\s*$/, '')
  return inner.split('|').map((c) => c.trim())
}

/** 表头分隔行：| --- | :---: | 之类（每格只含 - 和可选冒号）。 */
export function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
}

/** 块级解析：表格 / 标题 / 列表 / 分隔线 / 空行 / 普通行 */
export function renderTextBlock(text: string, keyBase: string): ReactNode {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const key = `${keyBase}-l${i}`

    // 表格：当前行是表格行，且下一行是 |---|---| 分隔行
    const headerCells = parseTableRow(line)
    if (headerCells) {
      const sepCells = i + 1 < lines.length ? parseTableRow(lines[i + 1]) : null
      if (sepCells && isSeparatorRow(sepCells)) {
        const body: string[][] = []
        let j = i + 2
        while (j < lines.length) {
          const rowCells = parseTableRow(lines[j])
          if (!rowCells || isSeparatorRow(rowCells)) break
          body.push(rowCells)
          j += 1
        }
        out.push(
          <div key={key} className="my-xs overflow-x-auto">
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {headerCells.map((cell, c) => (
                    <th
                      key={c}
                      className="px-sm py-2xs text-left"
                      style={{
                        border: '1px solid var(--color-rule-2)',
                        background: 'var(--color-paper)',
                        color: 'var(--color-ink-2)',
                        fontWeight: 600,
                      }}
                    >
                      {renderInline(cell, `${key}-h${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className="px-sm py-2xs"
                        style={{
                          border: '1px solid var(--color-rule)',
                          color: 'var(--color-neutral)',
                          verticalAlign: 'top',
                        }}
                      >
                        {renderInline(cell, `${key}-r${r}c${c}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        )
        i = j
        continue
      }
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      out.push(
        <div
          key={key}
          style={{
            color: 'var(--color-ink)',
            fontWeight: 600,
            fontSize: h[1].length <= 2 ? '1.05em' : '1em',
            marginTop: '0.8em',
            marginBottom: '0.2em',
          }}
        >
          {renderInline(h[2], key)}
        </div>,
      )
    } else if (/^\s*[-*]\s+/.test(line)) {
      out.push(
        <div key={key} className="flex gap-xs" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          <span aria-hidden="true" style={{ color: 'var(--color-muted)' }}>·</span>
          <span>{renderInline(line.replace(/^\s*[-*]\s+/, ''), key)}</span>
        </div>,
      )
    } else if (/^\s*-{3,}\s*$/.test(line)) {
      out.push(<hr key={key} style={{ border: 0, borderTop: '1px solid var(--color-rule)', margin: '0.6em 0' }} />)
    } else if (line.trim() === '') {
      out.push(<div key={key} style={{ height: '0.55em' }} />)
    } else {
      out.push(
        <div key={key} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {renderInline(line, key)}
        </div>,
      )
    }
    i += 1
  }
  return <div key={keyBase}>{out}</div>
}

/** 顶层：按 ``` 围栏切分，奇数段为代码块（首行可能是语言标签） */
export function renderBody(text: string) {
  const parts = text.split('```')
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf('\n')
      const lang = nl === -1 ? '' : part.slice(0, nl).trim()
      const code = nl === -1 ? part : part.slice(nl + 1)
      return (
        <div key={i} className="my-xs">
          {lang && (
            <div className="mono-label text-xs" style={{ color: 'var(--color-muted)', marginBottom: 2 }}>
              {lang}
            </div>
          )}
          <pre
            className="overflow-x-auto px-sm py-xs text-xs"
            style={{
              fontFamily: 'var(--font-mono)',
              background: 'var(--color-paper)',
              border: '1px solid var(--color-rule)',
              borderRadius: 'var(--radius-pill)',
              color: 'var(--color-ink-2)',
              lineHeight: 1.6,
            }}
          >
            {code}
          </pre>
        </div>
      )
    }
    return renderTextBlock(part, `t${i}`)
  })
}