import { useMemo } from 'react'
import { fmtTime, SLOT_MINUTES, toMinutes } from '../time.js'
import { slotKey } from '../reservations.js'

// Rooms down the side, 15-minute slots across the top.
// Click a slot to select it, or press and drag across a row to select several.
// While a hold is active the grid is `locked`: held slots are marked and nothing else can be picked.
export default function SlotGrid({ slots, date, selectedIds, heldIds, locked, busyKeys, onSlotDown, onSlotEnter, onSlotKey }) {
  const { rooms, times } = useMemo(() => {
    const byRoom = new Map()
    let min = Infinity
    let max = -Infinity
    for (const s of slots) {
      const start = toMinutes(s.StartTime)
      min = Math.min(min, start)
      max = Math.max(max, toMinutes(s.EndTime))
      if (!byRoom.has(s.RoomID)) byRoom.set(s.RoomID, { ...s, byStart: new Map() })
      byRoom.get(s.RoomID).byStart.set(start, s)
    }
    const times = []
    for (let t = min; t < max; t += SLOT_MINUTES) times.push(t)
    const rooms = [...byRoom.values()].sort(
      (a, b) => a.Floor - b.Floor || String(a.RoomNumber).localeCompare(String(b.RoomNumber)),
    )
    return { rooms, times }
  }, [slots])

  if (!rooms.length) return null

  // One header label per hour, spanning that hour's columns
  const hourLabels = []
  times.forEach((t, i) => {
    if (i === 0 || t % 60 === 0) {
      let span = 1
      while (i + span < times.length && times[i + span] % 60 !== 0) span++
      hourLabels.push({ t, col: i + 2, span })
    }
  })

  return (
    <div className="grid-scroll">
      <div
        className="slot-grid"
        style={{ gridTemplateColumns: `minmax(112px, 170px) repeat(${times.length}, minmax(20px, 1fr))` }}
      >
        <div className="grid-corner" style={{ gridRow: 1, gridColumn: 1 }}>
          Room
        </div>
        {hourLabels.map((h) => (
          <div key={h.t} className="grid-hour" style={{ gridRow: 1, gridColumn: `${h.col} / span ${h.span}` }}>
            {fmtTime(h.t)}
          </div>
        ))}

        {rooms.map((room, r) => (
          <RoomRow
            key={room.RoomID}
            row={r + 2}
            room={room}
            times={times}
            date={date}
            selectedIds={selectedIds}
            heldIds={heldIds}
            locked={locked}
            busyKeys={busyKeys}
            onSlotDown={onSlotDown}
            onSlotEnter={onSlotEnter}
            onSlotKey={onSlotKey}
          />
        ))}
      </div>
    </div>
  )
}

function RoomRow({ row, room, times, date, selectedIds, heldIds, locked, busyKeys, onSlotDown, onSlotEnter, onSlotKey }) {
  return (
    <>
      <div className="grid-room" style={{ gridRow: row, gridColumn: 1 }}>
        <strong>{room.RoomNumber}</strong>
        <span className="muted small">
          Floor {room.Floor} · {room.Seats} seats{room.Whiteboard ? ' · Whiteboard' : ''}
        </span>
      </div>
      {times.map((t, i) => {
        const style = { gridRow: row, gridColumn: i + 2 }
        const label = `${fmtTime(t)} – ${fmtTime(t + SLOT_MINUTES)}`
        const hourStart = t % 60 === 0 ? ' hour-start' : ''
        const yourRoom = busyKeys.get(slotKey(date, t))
        if (yourRoom) {
          const title =
            yourRoom === room.RoomNumber ? `Your reservation, ${label}` : `You already have ${yourRoom} at ${label}`
          return <div key={t} className={`cell cell-mine${hourStart}`} style={style} title={title} />
        }
        const slot = room.byStart.get(t)
        if (!slot) {
          return <div key={t} className={`cell cell-off${hourStart}`} style={style} title={`Not available, ${label}`} />
        }
        if (heldIds?.has(slot.RoomAvailabilityID)) {
          return (
            <div key={t} className={`cell cell-held${hourStart}`} style={style} title={`Held for you: ${room.RoomNumber}, ${label}`} />
          )
        }
        const isSelected = selectedIds.has(slot.RoomAvailabilityID)
        return (
          <button
            key={t}
            type="button"
            className={`cell cell-open${isSelected ? ' cell-selected' : ''}${hourStart}`}
            style={style}
            aria-pressed={isSelected}
            disabled={locked}
            aria-label={`${room.RoomNumber}, ${label}`}
            title={`${room.RoomNumber}, ${label}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
              onSlotDown(slot)
            }}
            onPointerEnter={() => onSlotEnter(slot)}
            onClick={(e) => {
              if (e.detail === 0) onSlotKey(slot) // keyboard (Enter / Space)
            }}
          />
        )
      })}
    </>
  )
}
