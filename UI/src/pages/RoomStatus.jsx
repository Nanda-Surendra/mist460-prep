import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import Alert from '../components/Alert.jsx'

// Live view of every study room, from get_occupancy_status_for_all_rooms.
// The status comes from the door sensors (Enter -> Occupied, Exit -> Vacant).
const REFRESH_MS = 15_000

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'Vacant', label: 'Vacant' },
  { id: 'Occupied', label: 'Occupied' },
]

const roomName = (r) => r.RoomNumber ?? `Room ${r.RoomID}`

export default function RoomStatus({ goTo }) {
  const [rooms, setRooms] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    try {
      setRooms(await api.occupancy())
      setUpdatedAt(new Date())
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll while the browser tab is visible; refresh right away when the user comes back to it
  useEffect(() => {
    let timer = null
    const start = () => {
      clearInterval(timer)
      timer = setInterval(load, REFRESH_MS)
    }
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(timer)
      } else {
        load()
        start()
      }
    }
    load()
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  const occupied = rooms.filter((r) => r.RoomOccupancyStatus === 'Occupied').length
  const vacant = rooms.length - occupied
  const visible = rooms.filter((r) => filter === 'all' || r.RoomOccupancyStatus === filter)

  // Group by floor (rooms without details from an older API version go in one group)
  const floors = new Map()
  for (const r of visible) {
    const key = r.Floor ?? 'other'
    if (!floors.has(key)) floors.set(key, [])
    floors.get(key).push(r)
  }
  const floorKeys = [...floors.keys()].sort((a, b) => (a === 'other') - (b === 'other') || a - b)
  for (const list of floors.values()) list.sort((a, b) => roomName(a).localeCompare(roomName(b)))

  return (
    <section className="stack-lg">
      <div className="page-head">
        <h1>Room status</h1>
        <p className="muted">
          Live occupancy from the room sensors. Updates every {REFRESH_MS / 1000} seconds
          {updatedAt && ` · last updated ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`}.
        </p>
      </div>

      <Alert type="error" onClose={() => setError('')}>
        {error}
      </Alert>

      {loading && <p className="muted">Reading room sensors…</p>}

      {!loading && rooms.length > 0 && (
        <>
          <div className="occ-summary">
            <div className="card occ-stat">
              <span className="kpi-label">Vacant</span>
              <span className="kpi-value occ-stat-vacant">{vacant}</span>
            </div>
            <div className="card occ-stat">
              <span className="kpi-label">Occupied</span>
              <span className="kpi-value occ-stat-occupied">{occupied}</span>
            </div>
            <div className="card occ-stat occ-stat-meter">
              <span className="kpi-label">
                {occupied} of {rooms.length} rooms in use
              </span>
              <span className="occ-meter" role="img" aria-label={`${occupied} of ${rooms.length} rooms occupied`}>
                <span className="occ-meter-fill" style={{ transform: `scaleX(${rooms.length ? occupied / rooms.length : 0})` }} />
              </span>
            </div>
          </div>

          <div className="row-between">
            <div className="segmented" role="tablist" aria-label="Show rooms">
              {FILTERS.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  className={filter === f.id ? 'active' : ''}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="row-between">
              <button className="link" onClick={() => goTo('now')}>
                Reserve an open room
              </button>
              <button className="btn btn-ghost btn-sm" onClick={load}>
                Refresh
              </button>
            </div>
          </div>

          {visible.length === 0 && (
            <div className="card empty">
              <p>
                <strong>No {filter.toLowerCase()} rooms right now.</strong>
              </p>
            </div>
          )}

          {floorKeys.map((floor) => (
            <div key={floor} className="stack">
              {floor !== 'other' && <h2>Floor {floor}</h2>}
              <div className="occ-grid">
                {floors.get(floor).map((r) => (
                  <RoomTile key={r.RoomID} room={r} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {!loading && !error && rooms.length === 0 && (
        <div className="card empty">
          <p>
            <strong>No rooms found.</strong>
          </p>
        </div>
      )}
    </section>
  )
}

function RoomTile({ room }) {
  const isOccupied = room.RoomOccupancyStatus === 'Occupied'
  const details = [
    room.Seats != null && `${room.Seats} seats`,
    room.Whiteboard != null && (room.Whiteboard ? 'Whiteboard' : 'No whiteboard'),
  ].filter(Boolean)

  return (
    <article className={`card occ-tile ${isOccupied ? 'occ-occupied' : 'occ-vacant'}`}>
      <div className="occ-tile-head">
        <h3>{roomName(room)}</h3>
        <span className="occ-status">
          <span className="occ-dot" aria-hidden="true" />
          {isOccupied ? 'Occupied' : 'Vacant'}
        </span>
      </div>
      {details.length > 0 && <p className="muted small">{details.join(' · ')}</p>}
    </article>
  )
}
