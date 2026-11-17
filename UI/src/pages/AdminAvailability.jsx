import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import Alert from '../components/Alert.jsx'
import { DAY_END, DAY_START, SLOT_MINUTES, addDaysISO, daysBetween, fmtDate, fmtTime, todayISO } from '../time.js'

const SLOTS_PER_ROOM_PER_DAY = (DAY_END - DAY_START) / SLOT_MINUTES
const MAX_DAYS = 62

export default function AdminAvailability() {
  const [start, setStart] = useState(todayISO())
  const [end, setEnd] = useState(addDaysISO(todayISO(), 6))
  const [existing, setExisting] = useState([]) // [{ date, open, rooms }]
  const [loadingExisting, setLoadingExisting] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Dates that already have open slots (creating them again would fail on the unique constraint)
  const loadExisting = useCallback(async () => {
    setLoadingExisting(true)
    try {
      const slots = await api.searchAvailability({})
      const byDate = new Map()
      for (const s of slots) {
        if (!byDate.has(s.AvailableDate)) byDate.set(s.AvailableDate, { date: s.AvailableDate, open: 0, rooms: new Set() })
        const d = byDate.get(s.AvailableDate)
        d.open += 1
        d.rooms.add(s.RoomID)
      }
      setExisting([...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingExisting(false)
    }
  }, [])

  useEffect(() => {
    loadExisting()
  }, [loadExisting])

  const dayCount = start && end ? daysBetween(start, end) + 1 : 0
  const overlapping = useMemo(
    () => existing.filter((d) => d.date >= start && d.date <= end).map((d) => d.date),
    [existing, start, end],
  )

  let problem = ''
  if (dayCount < 1) problem = 'The end date must be on or after the start date.'
  else if (dayCount > MAX_DAYS) problem = `Please create at most ${MAX_DAYS} days at a time.`
  else if (overlapping.length)
    problem = `Availability already exists for ${overlapping.map((d) => fmtDate(d)).join(', ')}. Choose dates without existing availability.`

  async function handleSubmit(e) {
    e.preventDefault()
    if (problem) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await api.createAvailability(start, end)
      setMessage(
        `Created ${SLOTS_PER_ROOM_PER_DAY} slots per room per day for ${dayCount} day${dayCount === 1 ? '' : 's'} (${fmtDate(start)} – ${fmtDate(end)}).`,
      )
      await loadExisting()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="stack-lg">
      <div className="page-head">
        <h1>Create room availability</h1>
        <p className="muted">
          Opens every room for reservations from {fmtTime(DAY_START)} to {fmtTime(DAY_END)} in 15-minute slots for each
          day in the period.
        </p>
      </div>

      <div className="two-col">
        <form className="card stack" onSubmit={handleSubmit}>
          <h2>New period</h2>
          <div className="row-2">
            <label className="field">
              <span>Start date</span>
              <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="field">
              <span>End date</span>
              <input type="date" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>

          {!problem && (
            <p className="muted small">
              {dayCount} day{dayCount === 1 ? '' : 's'} × {SLOTS_PER_ROOM_PER_DAY} slots per room.
            </p>
          )}
          <Alert type="warning">{problem}</Alert>
          <Alert type="error" onClose={() => setError('')}>
            {error}
          </Alert>
          <Alert type="success" onClose={() => setMessage('')}>
            {message}
          </Alert>

          <button className="btn btn-primary" disabled={saving || Boolean(problem)}>
            {saving ? 'Creating…' : 'Create availability'}
          </button>
        </form>

        <div className="card stack">
          <h2>Dates with open slots</h2>
          {loadingExisting && <p className="muted">Loading…</p>}
          {!loadingExisting && existing.length === 0 && <p className="muted">No availability has been created yet.</p>}
          {!loadingExisting && existing.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Rooms</th>
                    <th className="num">Open slots</th>
                  </tr>
                </thead>
                <tbody>
                  {existing.map((d) => (
                    <tr key={d.date} className={overlapping.includes(d.date) ? 'row-flag' : ''}>
                      <td>{fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="num">{d.rooms.size}</td>
                      <td className="num">{d.open}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
