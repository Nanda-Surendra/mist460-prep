import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import Alert from '../components/Alert.jsx'
import { fmtDate, fmtHour, weekdayIndex } from '../time.js'
import { ColumnChart, Heatmap, HBarList, useTooltip } from '../components/Charts.jsx'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const SOURCES = {
  reservations: {
    label: 'Reservations',
    help: 'Share of 15-minute slots that were reserved (planned use).',
    unit: 'reserved',
  },
  sensor: {
    label: 'Sensor entries',
    help: 'Number of times a sensor detected someone entering a room (actual use).',
    unit: 'entries',
  },
}

// Sum a list of {value, total} records into groups
function groupBy(records, keyFn) {
  const groups = new Map()
  for (const r of records) {
    const key = keyFn(r)
    const g = groups.get(key) ?? { value: 0, total: 0 }
    g.value += r.value
    g.total += r.total
    groups.set(key, g)
  }
  return groups
}

export default function AdminUsage() {
  const [range, setRange] = useState({ start: '', end: '' })
  const [source, setSource] = useState('reservations')
  const [view, setView] = useState('charts')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const tooltip = useTooltip()

  const load = useCallback(async (r) => {
    setLoading(true)
    setError('')
    try {
      setData(await api.usageStatistics(r.start, r.end))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load({ start: '', end: '' })
  }, [load])

  const isPct = source === 'reservations'

  // Normalise both data sources to { date, hour, room, value, total }
  const stats = useMemo(() => {
    if (!data) return null
    const records =
      source === 'reservations'
        ? data.reservations.map((r) => ({
            date: r.AvailableDate,
            hour: r.HourOfDay,
            room: r.RoomNumber,
            value: r.ReservedSlots,
            total: r.TotalSlots,
          }))
        : data.sensor.map((r) => ({ date: r.AvailableDate, hour: r.HourOfDay, room: r.RoomNumber, value: r.EnterEvents, total: 0 }))

    const metric = (g) => (isPct ? (g.total ? g.value / g.total : 0) : g.value)

    const dates = [...new Set(records.map((r) => r.date))].sort()
    const hours = [...new Set(records.map((r) => r.hour))].sort((a, b) => a - b)
    const cells = groupBy(records, (r) => `${r.date}|${r.hour}`)
    const byHour = groupBy(records, (r) => r.hour)
    const byWeekday = groupBy(records, (r) => weekdayIndex(r.date))
    const byRoom = groupBy(records, (r) => r.room)
    const overall = [...groupBy(records, () => 'all').values()][0] ?? { value: 0, total: 0 }

    const hourSeries = hours.map((h) => ({ key: h, label: fmtHour(h), value: metric(byHour.get(h)), raw: byHour.get(h) }))
    const daySeries = [...byWeekday.keys()]
      .sort((a, b) => a - b)
      .map((d) => ({ key: d, label: WEEKDAYS[d], value: metric(byWeekday.get(d)), raw: byWeekday.get(d) }))
    const roomSeries = [...byRoom.keys()]
      .sort()
      .map((room) => ({ key: room, label: room, value: metric(byRoom.get(room)), raw: byRoom.get(room) }))
      .sort((a, b) => b.value - a.value)

    const peak = (series) => series.reduce((best, s) => (!best || s.value > best.value ? s : best), null)

    return {
      records,
      dates,
      hours,
      cells: (date, hour) => {
        const g = cells.get(`${date}|${hour}`)
        return g ? { value: metric(g), raw: g } : null
      },
      hourSeries,
      daySeries,
      roomSeries,
      overall,
      overallMetric: metric(overall),
      peakHour: peak(hourSeries),
      peakDay: peak(daySeries),
      peakRoom: roomSeries[0] ?? null,
    }
  }, [data, source, isPct])

  const fmtValue = (v) => (isPct ? `${Math.round(v * 100)}%` : Math.round(v).toLocaleString())

  // Bar charts scale to the busiest value rounded up (to the next 10% for percentages)
  const scaleMax = (series) => {
    const top = Math.max(0, ...series.map((s) => s.value))
    return isPct ? Math.min(1, Math.max(0.1, Math.ceil(top * 10) / 10)) : Math.max(1, Math.ceil(top))
  }
  const describe = (raw) =>
    isPct ? `${raw.value} of ${raw.total} slots reserved (${fmtValue(raw.total ? raw.value / raw.total : 0)})` : `${raw.value} entries`

  function handleSubmit(e) {
    e.preventDefault()
    load(range)
  }

  const hasData = stats && stats.records.length > 0 && (isPct ? stats.overall.total > 0 : stats.overall.value > 0)

  return (
    <section className="stack-lg">
      <div className="page-head">
        <h1>Usage analysis</h1>
        <p className="muted">When are rooms busiest? Compare reservations (planned) with sensor entries (actual).</p>
      </div>

      <form className="card filters" onSubmit={handleSubmit}>
        <label className="field">
          <span>From date</span>
          <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
        </label>
        <label className="field">
          <span>To date</span>
          <input type="date" value={range.end} min={range.start} onChange={(e) => setRange({ ...range, end: e.target.value })} />
        </label>
        <div className="filter-actions">
          <button className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setRange({ start: '', end: '' })
              load({ start: '', end: '' })
            }}
          >
            All dates
          </button>
        </div>
        <div className="filter-push">
          <div className="segmented" role="tablist" aria-label="Data source">
            {Object.entries(SOURCES).map(([id, s]) => (
              <button
                type="button"
                key={id}
                role="tab"
                aria-selected={source === id}
                className={source === id ? 'active' : ''}
                onClick={() => setSource(id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </form>

      <Alert type="error" onClose={() => setError('')}>
        {error}
      </Alert>

      {loading && <p className="muted">Loading usage data…</p>}

      {!loading && stats && !hasData && (
        <div className="card empty">
          <p>
            <strong>
              {source === 'sensor' ? 'No sensor entries recorded' : 'No reservations'} in this period.
            </strong>
          </p>
          <p className="muted">Try a different date range or data source.</p>
        </div>
      )}

      {!loading && hasData && (
        <>
          <div className="kpis">
            <Kpi
              label={isPct ? 'Slots reserved' : 'Total entries'}
              value={isPct ? fmtValue(stats.overallMetric) : stats.overall.value.toLocaleString()}
              note={isPct ? `${((stats.overall.value * 15) / 60).toLocaleString()} hours booked` : `${stats.dates.length} days with activity`}
            />
            <Kpi label="Busiest hour" value={stats.peakHour?.label} note={fmtValue(stats.peakHour?.value ?? 0)} />
            <Kpi label="Busiest day" value={stats.peakDay?.label} note={fmtValue(stats.peakDay?.value ?? 0)} />
            <Kpi label="Busiest room" value={stats.peakRoom?.label} note={fmtValue(stats.peakRoom?.value ?? 0)} />
          </div>

          <div className="row-between">
            <p className="muted small">{SOURCES[source].help}</p>
            <div className="segmented segmented-sm" role="tablist" aria-label="View">
              <button type="button" role="tab" aria-selected={view === 'charts'} className={view === 'charts' ? 'active' : ''} onClick={() => setView('charts')}>
                Charts
              </button>
              <button type="button" role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>
                Table
              </button>
            </div>
          </div>

          {view === 'charts' ? (
            <>
              <div className="card">
                <div className="card-head">
                  <h2>Peak times by day and hour</h2>
                </div>
                <Heatmap
                  rows={stats.dates.map((d) => ({ key: d, label: fmtDate(d) }))}
                  cols={stats.hours.map((h) => ({ key: h, label: fmtHour(h) }))}
                  cell={stats.cells}
                  fmtValue={fmtValue}
                  describe={(row, col, c) => `${fmtDate(row.key, { weekday: 'long', month: 'short', day: 'numeric' })}, ${col.label}: ${describe(c.raw)}`}
                  tooltip={tooltip}
                />
              </div>

              <div className="two-col">
                <div className="card">
                  <div className="card-head">
                    <h2>By hour of day</h2>
                  </div>
                  <ColumnChart
                    series={stats.hourSeries}
                    fmtValue={fmtValue}
                    describe={(s) => `${s.label}: ${describe(s.raw)}`}
                    tooltip={tooltip}
                    highlightKey={stats.peakHour?.key}
                    max={scaleMax(stats.hourSeries)}
                  />
                </div>
                <div className="card">
                  <div className="card-head">
                    <h2>By day of week</h2>
                  </div>
                  <HBarList
                    series={stats.daySeries}
                    fmtValue={fmtValue}
                    describe={(s) => `${s.label}: ${describe(s.raw)}`}
                    tooltip={tooltip}
                    max={scaleMax(stats.daySeries)}
                  />
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h2>By room</h2>
                </div>
                <HBarList
                  series={stats.roomSeries}
                  fmtValue={fmtValue}
                  describe={(s) => `${s.label}: ${describe(s.raw)}`}
                  tooltip={tooltip}
                  max={scaleMax(stats.roomSeries)}
                />
              </div>
            </>
          ) : (
            <UsageTable stats={stats} isPct={isPct} fmtValue={fmtValue} />
          )}
        </>
      )}
      {tooltip.element}
    </section>
  )
}

function Kpi({ label, value, note }) {
  return (
    <div className="card kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value ?? '—'}</span>
      <span className="kpi-note">{note}</span>
    </div>
  )
}

function UsageTable({ stats, isPct, fmtValue }) {
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              {stats.hours.map((h) => (
                <th key={h} className="num">
                  {fmtHour(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.dates.map((d) => (
              <tr key={d}>
                <td>{fmtDate(d)}</td>
                {stats.hours.map((h) => {
                  const c = stats.cells(d, h)
                  return (
                    <td key={h} className="num">
                      {c ? (isPct ? fmtValue(c.value) : c.raw.value) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
