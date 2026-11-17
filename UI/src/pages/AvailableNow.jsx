import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import Alert from '../components/Alert.jsx'
import { busySlotKeys, loadMyReservations, reserveSlots, slotKey } from '../reservations.js'
import {
  DAY_END,
  DAY_START,
  MAX_SLOTS,
  SLOT_MINUTES,
  currentSlotStart,
  fmtDuration,
  fmtTime,
  minutesToTime,
  toMinutes,
  todayISO,
} from '../time.js'

const REFRESH_MS = 60_000

// For each room that is free right now, work out how long it stays free.
function roomsFreeNow(slots, occupancy, slotStart) {
  const occupied = new Map(occupancy.map((o) => [o.RoomID, o.RoomOccupancyStatus]))
  const byRoom = new Map()
  for (const s of slots) {
    if (!byRoom.has(s.RoomID)) byRoom.set(s.RoomID, [])
    byRoom.get(s.RoomID).push(s)
  }
  const rooms = []
  for (const roomSlots of byRoom.values()) {
    roomSlots.sort((a, b) => toMinutes(a.StartTime) - toMinutes(b.StartTime))
    if (toMinutes(roomSlots[0].StartTime) !== slotStart) continue // not free right now
    const run = [roomSlots[0]]
    for (const s of roomSlots.slice(1)) {
      if (toMinutes(s.StartTime) !== toMinutes(run[run.length - 1].EndTime)) break
      run.push(s)
    }
    rooms.push({
      ...roomSlots[0],
      run,
      freeUntil: toMinutes(run[run.length - 1].EndTime),
      sensorOccupied: occupied.get(roomSlots[0].RoomID) === 'Occupied',
    })
  }
  // Rooms the sensor says are empty first, then the ones free the longest
  return rooms.sort((a, b) => a.sensorOccupied - b.sensorOccupied || b.freeUntil - a.freeUntil)
}

export default function AvailableNow({ user, goTo }) {
  const [rooms, setRooms] = useState([])
  const [myCurrentRoom, setMyCurrentRoom] = useState(null)
  const [filters, setFilters] = useState({ seats: '', whiteboard: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)
  const [savingRoom, setSavingRoom] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  const slotStart = currentSlotStart()
  const openHours = slotStart >= DAY_START && slotStart < DAY_END

  const load = useCallback(async () => {
    setError('')
    try {
      const today = todayISO()
      const start = currentSlotStart()
      const [slots, occupancy, mine] = await Promise.all([
        api.searchAvailability({ available_date: today, start_time: minutesToTime(start) }),
        api.occupancy(),
        loadMyReservations(user.AppUserID),
      ])
      setRooms(roomsFreeNow(slots, occupancy, start))
      setMyCurrentRoom(busySlotKeys(mine).get(slotKey(today, start)) ?? null)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user.AppUserID])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  async function handleReserve(room, minutes) {
    setSavingRoom(room.RoomID)
    setError('')
    setSuccess(null)
    try {
      const ids = room.run.slice(0, minutes / SLOT_MINUTES).map((s) => s.RoomAvailabilityID)
      const reservationId = await reserveSlots(user.AppUserID, ids)
      setSuccess({ reservationId, room: room.RoomNumber, until: toMinutes(room.run[ids.length - 1].EndTime) })
    } catch (err) {
      setError(`Reservation not made: ${err.message}`)
    } finally {
      setSavingRoom(null)
      load()
    }
  }

  const visible = rooms.filter(
    (r) => (!filters.seats || r.Seats >= Number(filters.seats)) && (!filters.whiteboard || r.Whiteboard),
  )

  return (
    <section className="stack-lg">
      <div className="page-head">
        <h1>Find me a room now</h1>
        <p className="muted">
          Rooms open for the current time slot ({fmtTime(slotStart)} – {fmtTime(slotStart + SLOT_MINUTES)}).
          {updatedAt && ` Updated ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`}
        </p>
      </div>

      <div className="card filters filters-inline">
        <label className="field">
          <span>Min. seats</span>
          <input
            type="number"
            min="1"
            placeholder="Any"
            value={filters.seats}
            onChange={(e) => setFilters({ ...filters, seats: e.target.value })}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={filters.whiteboard}
            onChange={(e) => setFilters({ ...filters, whiteboard: e.target.checked })}
          />
          Needs a whiteboard
        </label>
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      <Alert type="error" onClose={() => setError('')}>
        {error}
      </Alert>
      {success && (
        <Alert type="success" onClose={() => setSuccess(null)}>
          <strong>
            {success.room} is yours until {fmtTime(success.until)}
          </strong>{' '}
          (reservation #{success.reservationId}).{' '}
          <button className="link" onClick={() => goTo('mine')}>
            Go to My reservations to check in
          </button>
        </Alert>
      )}
      {myCurrentRoom && !success && (
        <Alert type="info">
          You already have <strong>{myCurrentRoom}</strong> reserved right now, so you can't book a second room for
          this time.
        </Alert>
      )}

      {!openHours && !loading && (
        <div className="card empty">
          <p>
            <strong>Rooms can be reserved between {fmtTime(DAY_START)} and {fmtTime(DAY_END)}.</strong>
          </p>
          <p className="muted">
            Use{' '}
            <button className="link" onClick={() => goTo('find')}>
              Find a room
            </button>{' '}
            to book ahead.
          </p>
        </div>
      )}

      {loading && <p className="muted">Looking for open rooms…</p>}

      {!loading && openHours && visible.length === 0 && (
        <div className="card empty">
          <p>
            <strong>No rooms are open right now{rooms.length ? ' that match your filters' : ''}.</strong>
          </p>
          <p className="muted">
            Try{' '}
            <button className="link" onClick={() => goTo('find')}>
              Find a room
            </button>{' '}
            to see later times.
          </p>
        </div>
      )}

      <div className="room-cards">
        {visible.map((room) => (
          <RoomNowCard
            key={room.RoomID}
            room={room}
            disabled={Boolean(myCurrentRoom) || savingRoom !== null}
            saving={savingRoom === room.RoomID}
            onReserve={handleReserve}
          />
        ))}
      </div>
    </section>
  )
}

function RoomNowCard({ room, disabled, saving, onReserve }) {
  const maxMinutes = Math.min(room.run.length, MAX_SLOTS) * SLOT_MINUTES
  const choices = []
  for (let m = SLOT_MINUTES; m <= maxMinutes; m += SLOT_MINUTES) choices.push(m)
  const [minutes, setMinutes] = useState(Math.min(60, maxMinutes))

  return (
    <article className="card room-card">
      <div className="room-card-head">
        <h3>{room.RoomNumber}</h3>
        {room.sensorOccupied ? (
          <span className="badge badge-warning" title="The room sensor detected someone inside">
            ● Sensor: occupied
          </span>
        ) : (
          <span className="badge badge-good" title="The room sensor shows the room is empty">
            ● Sensor: empty
          </span>
        )}
      </div>
      <p className="muted small">
        Floor {room.Floor} · {room.Seats} seats · {room.Whiteboard ? 'Whiteboard' : 'No whiteboard'}
      </p>
      <p className="free-until">
        Free until <strong>{fmtTime(room.freeUntil)}</strong>
      </p>
      <div className="room-card-actions">
        <label className="field field-compact">
          <span className="sr-only">Duration</span>
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} disabled={disabled}>
            {choices.map((m) => (
              <option key={m} value={m}>
                {fmtDuration(m)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" disabled={disabled} onClick={() => onReserve(room, minutes)}>
          {saving ? 'Reserving…' : 'Reserve now'}
        </button>
      </div>
    </article>
  )
}
