import { useEffect, useState } from 'react'

// Single-hue blue ramp (light -> dark) for magnitude. In dark mode the ramp is
// reversed so "near zero" fades toward the dark background.
const BLUE_RAMP = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b',
]

function useDarkMode() {
  const query = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const onChange = (e) => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return dark
}

function rampColor(t, dark) {
  const ramp = dark ? [...BLUE_RAMP].reverse() : BLUE_RAMP
  const i = Math.min(ramp.length - 1, Math.max(0, Math.round(t * (ramp.length - 1))))
  return ramp[i]
}

// ---------- tooltip ----------
export function useTooltip() {
  const [tip, setTip] = useState(null)
  const show = (e, text) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX || rect.left + rect.width / 2
    const y = e.clientY || rect.top
    setTip({ x, y, text, flip: x > window.innerWidth - 260 })
  }
  const hide = () => setTip(null)
  const element = tip ? (
    <div
      className="chart-tooltip"
      role="tooltip"
      style={{
        left: tip.x + (tip.flip ? -14 : 14),
        top: tip.y + 14,
        transform: tip.flip ? 'translateX(-100%)' : undefined,
      }}
    >
      {tip.text}
    </div>
  ) : null
  return { show, hide, element }
}

const hoverProps = (tooltip, text) => ({
  onMouseMove: (e) => tooltip.show(e, text),
  onMouseLeave: tooltip.hide,
  onFocus: (e) => tooltip.show(e, text),
  onBlur: tooltip.hide,
  tabIndex: 0,
  'aria-label': text,
})

// ---------- heatmap: rows x cols, color = value ----------
export function Heatmap({ rows, cols, cell, fmtValue, describe, tooltip }) {
  const dark = useDarkMode()
  let max = 0
  for (const r of rows) for (const c of cols) max = Math.max(max, cell(r.key, c.key)?.value ?? 0)

  return (
    <div className="heatmap-wrap">
      <div className="heatmap" style={{ gridTemplateColumns: `minmax(90px, 120px) repeat(${cols.length}, minmax(36px, 1fr))` }}>
        <div />
        {cols.map((c) => (
          <div key={c.key} className="heatmap-col-label">
            {c.label}
          </div>
        ))}
        {rows.map((r) => (
          <HeatmapRow key={r.key} r={r} cols={cols} cell={cell} max={max} dark={dark} describe={describe} tooltip={tooltip} />
        ))}
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>{fmtValue(0)}</span>
        <span
          className="heat-legend-bar"
          style={{ background: `linear-gradient(90deg, ${(dark ? [...BLUE_RAMP].reverse() : BLUE_RAMP).join(',')})` }}
        />
        <span>{fmtValue(max)}</span>
      </div>
    </div>
  )
}

function HeatmapRow({ r, cols, cell, max, dark, describe, tooltip }) {
  return (
    <>
      <div className="heatmap-row-label">{r.label}</div>
      {cols.map((c) => {
        const v = cell(r.key, c.key)
        if (!v) return <div key={c.key} className="heat-cell heat-empty" title="No data" />
        const color = v.value > 0 ? rampColor(max ? v.value / max : 0, dark) : undefined
        return (
          <div
            key={c.key}
            className={`heat-cell ${v.value > 0 ? '' : 'heat-zero'}`}
            style={color ? { background: color } : undefined}
            {...hoverProps(tooltip, describe(r, c, v))}
          />
        )
      })}
    </>
  )
}

// ---------- vertical columns (e.g. by hour) ----------
export function ColumnChart({ series, fmtValue, describe, tooltip, highlightKey, max }) {
  const top = max ?? Math.max(1, ...series.map((s) => s.value))
  return (
    <div className="colchart">
      <div className="colchart-axis" aria-hidden="true">
        <span>{fmtValue(top)}</span>
        <span>{fmtValue(top / 2)}</span>
        <span>{fmtValue(0)}</span>
      </div>
      <div className="colchart-plot">
        <div className="colchart-grid" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="colchart-bars">
          {series.map((s, i) => (
            <div key={s.key} className="colchart-col" {...hoverProps(tooltip, describe(s))}>
              <div className="colchart-bar-area">
                {s.key === highlightKey && s.value > 0 && <span className="colchart-peak">{fmtValue(s.value)}</span>}
                <div className="colchart-bar" style={{ height: `${(s.value / top) * 100}%` }} />
              </div>
              <span className={`colchart-label ${i % 2 ? 'colchart-label-odd' : ''}`}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- horizontal bars with labels (e.g. by room, by weekday) ----------
export function HBarList({ series, fmtValue, describe, tooltip, max }) {
  const top = max ?? Math.max(1, ...series.map((s) => s.value))
  return (
    <div className="hbars">
      {series.map((s) => (
        <div key={s.key} className="hbar-row" {...hoverProps(tooltip, describe(s))}>
          <span className="hbar-label">{s.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(s.value / top) * 100}%` }} />
          </span>
          <span className="hbar-value">{fmtValue(s.value)}</span>
        </div>
      ))}
    </div>
  )
}
