import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import Alert from '../components/Alert.jsx'
import { HOLD_MINUTES, confirmHold, loadMyReservations, loadSavedHold, saveHold } from '../reservations.js'
import { fmtDate, fmtDuration, fmtTime, nowMinutes, todayISO } from '../time.js'

// Check-in opens this many minutes before the first slot starts.
// Set ENFORCE_CHECK_IN_WINDOW to false to allow check-in at any time (handy for demos).
const CHECK_IN_EARLY_MINUTES = 15
const ENFORCE_CHECK_IN_WINDOW = true

const STATUS_LABEL = {
  Pending: 'On hold',
  Reserved: 'Reserved',
  CheckedIn: 'Checked in',
  CheckedOut: 'Checked out',
  Cancelled: 'Cancelled',
}

// Where a reservation sits relative to now: 'upcoming' | 'current' | 'past' | 'none'
function timing(r) {
  if (!r.date) return 'none'
  const today = todayISO()
  if (r.date > today) return 'upcoming'
  if (r.date < today) return 'past'
  const now = nowMinutes()
  if (now >= r.end) return 'past'
  if (now >= r.start) return 'current'
  return 'upcoming'
}

function canCheckIn(r) {
  if (r.ReservationStatus !== 'Reserved' || !r.date) return false
  if (!ENFORCE_CHECK_IN_WINDOW) return true
  const now = nowMinutes()
  return r.date === todayISO() && now >= r.start - CHECK_IN_EARLY_MINUTES && now < r.end
}

export default function MyReservations({ user, goTo }) {
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [workingId, setWorkingId] = useState(null)

  const load = useCallback(async () => {
    try {
      setReservations(await loadMyReservations(user.AppUserID))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user.AppUserID])

  useEffect(() => {
    load()
  }, [load])

  async function act(reservation, action) {
    const id = reservation.ReservationID
    if (action === 'cancel' && !window.confirm(`Cancel reservation #${id}? The time slots will be released.`)) return
    if (action === 'release' && !window.confirm(`Release the slots held for reservation #${id}?`)) return
    setWorkingId(id)
    setError('')
    setMessage('')
    try {
      if (action === 'checkin') await api.checkIn(id)
      if (action === 'checkout') await api.checkOut(id)
      if (action === 'cancel' || action === 'release') await api.cancelReservation(id)
      if (action === 'confirm') await confirmHold(id)
      setMessage(
        {
          checkin: 'You are checked in.',
          checkout: 'You are checked out. Thanks!',
          cancel: 'Reservation cancelled.',
          release: 'Hold released.',
          confirm: 'Reservation confirmed.',
        }[action] + ` (reservation #${id})`,
      )
      await load()
    } catch (err) {
      setError(err.message)
      await load()
    } finally {
      // A hold confirmed or released here is no longer in progress on "Find a room"
      if (action === 'confirm' || action === 'release') {
        if (loadSavedHold(user.AppUserID)?.reservationId === id) saveHold(user.AppUserID, null)
      }
      setWorkingId(null)
    }
  }

  // Active = still to use (or in use). Everything else is history.
  // Reservations that never got a slot (a failed booking attempt) are hidden.
  const visible = reservations.filter((r) => r.slots.length > 0 || r.TotalTimeReserved > 0)
  const active = visible
    .filter(
      (r) =>
        r.ReservationStatus === 'CheckedIn' ||
        (['Reserved', 'Pending'].includes(r.ReservationStatus) && timing(r) !== 'past'),
    )
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.start - b.start)
  const history = visible
    .filter((r) => !active.includes(r))
    .sort((a, b) => String(b.ReservationDateTime).localeCompare(String(a.ReservationDateTime)))

  return (
    <section className="stack-lg">
      <div className="page-head">
        <h1>My reservations</h1>
        <p className="muted">Check in when you arrive, check out when you leave, or cancel if plans change.</p>
      </div>

      <Alert type="error" onClose={() => setError('')}>
        {error}
      </Alert>
      <Alert type="success" onClose={() => setMessage('')}>
        {message}
      </Alert>

      {loading && <p className="muted">Loading your reservations…</p>}

      {!loading && (
        <>
          <div className="stack">
            <h2>Upcoming &amp; current</h2>
            {active.length === 0 ? (
              <div className="card empty">
                <p>
                  <strong>You have no upcoming reservations.</strong>
                </p>
                <p className="muted">
                  <button className="link" onClick={() => goTo('now')}>
                    Grab a room now
                  </button>{' '}
                  or{' '}
                  <button className="link" onClick={() => goTo('find')}>
                    search for a time
                  </button>
                  .
                </p>
              </div>
            ) : (
              <div className="reservation-list">
                {active.map((r) => (
                  <ReservationCard key={r.ReservationID} r={r} working={workingId === r.ReservationID} onAction={act} />
                ))}
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div className="stack">
              <h2>History</h2>
              <div className="reservation-list">
                {history.map((r) => (
                  <ReservationCard key={r.ReservationID} r={r} past />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ReservationCard({ r, past = false, working = false, onAction }) {
  const when = timing(r)
  const statusText = r.ReservationStatus === 'Reserved' && past && when === 'past' ? 'Not used' : STATUS_LABEL[r.ReservationStatus]
  const checkInReady = canCheckIn(r)

  return (
    <article className={`card reservation ${past ? 'reservation-past' : ''}`}>
      <div className="reservation-main">
        <div className="reservation-when">
          {r.date ? (
            <>
              <strong>{fmtDate(r.date, { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
              <span>
                {fmtTime(r.start)} – {fmtTime(r.end)}
              </span>
            </>
          ) : (
            <strong>Time slots released</strong>
          )}
        </div>
        <div className="reservation-where">
          {r.ranges.map((range) => (
            <div key={`${range.room}-${range.start}`}>
              <strong>{range.room}</strong>{' '}
              <span className="muted small">
                {r.ranges.length > 1 && `${fmtTime(range.start)}–${fmtTime(range.end)} · `}Floor {range.floor} ·{' '}
                {range.seats} seats{range.whiteboard ? ' · Whiteboard' : ''}
              </span>
            </div>
          ))}
          <span className="muted small">
            #{r.ReservationID} · {fmtDuration(r.TotalTimeReserved)}
          </span>
        </div>
        <span className={`badge badge-status status-${r.ReservationStatus}`}>
          {when === 'current' && r.ReservationStatus === 'CheckedIn' ? '● ' : ''}
          {statusText}
        </span>
      </div>

      {!past && (
        <div className="reservation-actions">
          {r.ReservationStatus === 'Pending' && (
            <>
              <button className="btn btn-primary btn-sm" disabled={working} onClick={() => onAction(r, 'confirm')}>
                Confirm reservation
              </button>
              <span className="muted small">Held slots are released {HOLD_MINUTES} minutes after you start booking.</span>
              <button className="btn btn-danger-ghost btn-sm" disabled={working} onClick={() => onAction(r, 'release')}>
                Release
              </button>
            </>
          )}
          {r.ReservationStatus === 'Reserved' && (
            <>
              <button
                className="btn btn-primary btn-sm"
                disabled={working || !checkInReady}
                onClick={() => onAction(r, 'checkin')}
              >
                Check in
              </button>
              {!checkInReady && (
                <span className="muted small">
                  Check-in opens {fmtTime(Math.max(0, r.start - CHECK_IN_EARLY_MINUTES))}
                  {r.date !== todayISO() ? ` on ${fmtDate(r.date)}` : ''}
                </span>
              )}
              <button className="btn btn-danger-ghost btn-sm" disabled={working} onClick={() => onAction(r, 'cancel')}>
                Cancel reservation
              </button>
            </>
          )}
          {r.ReservationStatus === 'CheckedIn' && (
            <button className="btn btn-primary btn-sm" disabled={working} onClick={() => onAction(r, 'checkout')}>
              Check out
            </button>
          )}
        </div>
      )}
    </article>
  )
}
