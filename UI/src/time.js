// Date/time helpers. Times from the API look like "08:15:00"; dates like "2026-11-10".
// Internally we work with "minutes since midnight" because it makes slot math easy.

export const SLOT_MINUTES = 15
export const MAX_SLOTS = 8 // 8 x 15 min = 2 hours
export const DAY_START = 8 * 60 // 8 AM
export const DAY_END = 20 * 60 // 8 PM

const pad = (n) => String(n).padStart(2, '0')

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  return todayISO(new Date(y, m - 1, d + days))
}

export function daysBetween(startISO, endISO) {
  const [y1, m1, d1] = startISO.split('-').map(Number)
  const [y2, m2, d2] = endISO.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

export function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`
}

export function nowMinutes(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes()
}

// Start of the 15-minute slot we are in right now (e.g. 9:07 -> 9:00)
export function currentSlotStart(d = new Date()) {
  return Math.floor(nowMinutes(d) / SLOT_MINUTES) * SLOT_MINUTES
}

export function fmtTime(value) {
  const minutes = typeof value === 'number' ? value : toMinutes(value)
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return m ? `${h12}:${pad(m)} ${suffix}` : `${h12} ${suffix}`
}

export function fmtHour(hour) {
  return fmtTime(hour * 60)
}

export function fmtDate(iso, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, options)
}

export function weekdayIndex(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7 // Monday = 0
}

export function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} hr ${m} min` : `${h} hr`
}

export function timeOptions(from = DAY_START, to = DAY_END) {
  const out = []
  for (let t = from; t <= to; t += SLOT_MINUTES) out.push(t)
  return out
}

// Merge 15-minute slots into readable ranges, e.g. REH 4213 9:00-10:00 AM
export function groupIntoRanges(slots) {
  const sorted = [...slots].sort(
    (a, b) =>
      String(a.AvailableDate).localeCompare(String(b.AvailableDate)) ||
      toMinutes(a.StartTime) - toMinutes(b.StartTime) ||
      String(a.RoomNumber).localeCompare(String(b.RoomNumber)),
  )
  const ranges = []
  for (const slot of sorted) {
    const start = toMinutes(slot.StartTime)
    const end = toMinutes(slot.EndTime)
    const last = ranges.find((r) => r.date === slot.AvailableDate && r.room === slot.RoomNumber && r.end === start)
    if (last) {
      last.end = end
      last.slotCount += 1
    } else {
      ranges.push({
        date: slot.AvailableDate,
        room: slot.RoomNumber,
        floor: slot.Floor,
        seats: slot.Seats,
        whiteboard: slot.Whiteboard,
        start,
        end,
        slotCount: 1,
      })
    }
  }
  return ranges
}
