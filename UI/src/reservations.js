import { api } from './api.js'
import { groupIntoRanges, toMinutes } from './time.js'

// 'Pending' = slots are on hold, waiting for confirm_reservation
export const ACTIVE_STATUSES = ['Reserved', 'CheckedIn']

// Load the user's reservations together with their rooms and time slots.
export async function loadMyReservations(appUserId) {
  const reservations = await api.userReservations(appUserId)
  const withSlots = await Promise.all(
    reservations.map(async (r) => ({ ...r, slots: await api.reservationDetails(r.ReservationID) })),
  )
  return withSlots.map((r) => {
    const ranges = groupIntoRanges(r.slots)
    const starts = r.slots.map((s) => toMinutes(s.StartTime))
    const ends = r.slots.map((s) => toMinutes(s.EndTime))
    return {
      ...r,
      ranges,
      date: ranges[0]?.date ?? null,
      start: starts.length ? Math.min(...starts) : null,
      end: ends.length ? Math.max(...ends) : null,
    }
  })
}

export const slotKey = (date, startMinutes) => `${date}|${startMinutes}`

// Time slots the user already holds (in any room) - used to block double-booking.
export function busySlotKeys(reservations) {
  const keys = new Map()
  for (const r of reservations) {
    if (!ACTIVE_STATUSES.includes(r.ReservationStatus)) continue
    for (const s of r.slots) keys.set(slotKey(s.AvailableDate, toMinutes(s.StartTime)), s.RoomNumber)
  }
  return keys
}

export const HOLD_MINUTES = 10

// The hold in progress on "Find a room" survives switching tabs: it lives in sessionStorage
// until it is confirmed, released, or expires. Shape: { reservationId, expiresAt, date, slots }
const holdKey = (userId) => `studyroom.hold.${userId}`

export function loadSavedHold(userId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(holdKey(userId)))
    return saved && saved.expiresAt > Date.now() ? saved : null
  } catch {
    return null
  }
}

export function saveHold(userId, hold) {
  try {
    if (hold) sessionStorage.setItem(holdKey(userId), JSON.stringify(hold))
    else sessionStorage.removeItem(holdKey(userId))
  } catch {
    // storage blocked - the hold still works until the user leaves the page
  }
}

// Steps 3-4 of the booking workflow: start a reservation, then hold each chosen
// 15-minute slot. Held slots are kept for HOLD_MINUTES until confirmed.
// If any slot fails (e.g. someone else just took it), the reservation is
// cancelled so the user never ends up with half a hold.
// onProgress(heldCount) is called after each slot is held.
export async function holdSlots(appUserId, roomAvailabilityIds, onProgress = () => {}) {
  // The hold clock starts when the reservation is created, so measure from here.
  const expiresAt = Date.now() + HOLD_MINUTES * 60_000
  const reservationId = await api.startReservation(appUserId)
  try {
    for (const [i, id] of roomAvailabilityIds.entries()) {
      await api.holdSlot(reservationId, id)
      onProgress(i + 1)
    }
  } catch (error) {
    await api.cancelReservation(reservationId).catch(() => {}) // the original error is the useful one
    throw error
  }
  return { reservationId, expiresAt }
}

// Step 5: turn the hold into a reservation. Throws if the hold has expired.
export async function confirmHold(reservationId) {
  const confirmed = await api.confirmReservation(reservationId)
  if (!confirmed) {
    throw new Error(`The ${HOLD_MINUTES}-minute hold expired, so the slots were released. Please choose them again.`)
  }
}

// Hold and confirm in one go (used by "Reserve now", where the user has already decided).
export async function reserveSlots(appUserId, roomAvailabilityIds) {
  const { reservationId } = await holdSlots(appUserId, roomAvailabilityIds)
  await confirmHold(reservationId)
  return reservationId
}
