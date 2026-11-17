import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import Alert from '../components/Alert.jsx'
import SlotGrid from '../components/SlotGrid.jsx'
import {
  HOLD_MINUTES,
  busySlotKeys,
  confirmHold,
  holdSlots,
  loadMyReservations,
  loadSavedHold,
  saveHold,
} from '../reservations.js'
import {
  MAX_SLOTS,
  SLOT_MINUTES,
  fmtDate,
  fmtDuration,
  fmtTime,
  groupIntoRanges,
  minutesToTime,
  nowMinutes,
  timeOptions,
  toMinutes,
  todayISO,
} from '../time.js'

// Booking workflow on this page:
//   check_room_availability -> (pick slots) -> start_reservation + hold_slot -> confirm_reservation
//   Release uses cancel_reservation; the receipt comes from get_reservation_details.

const DEFAULT_FILTERS = { date: todayISO(), from: '', to: '', floor: '', seats: '', whiteboard: '' }
const STEPS = ['Choose time slots', `Hold for ${HOLD_MINUTES} min`, 'Confirm']

// Re-renders once a second while `active`, so the countdown stays current
function useNow(active) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

const sortByStart = (list) => [...list].sort((a, b) => toMinutes(a.StartTime) - toMinutes(b.StartTime))
const describeRanges = (ranges) => ranges.map((r) => `${r.room} ${fmtTime(r.start)}–${fmtTime(r.end)}`).join(' · ')

export default function FindRoom({ user, goTo }) {
  const savedHold = useMemo(() => loadSavedHold(user.AppUserID), [user.AppUserID])
  const initialFilters = savedHold ? { ...DEFAULT_FILTERS, date: savedHold.date } : DEFAULT_FILTERS

  const [filters, setFilters] = useState(initialFilters)
  const [searchedDate, setSearchedDate] = useState(null)
  const [slots, setSlots] = useState([])
  const [floors, setFloors] = useState([])
  const [busyKeys, setBusyKeys] = useState(new Map())
  const [selected, setSelected] = useState(new Map()) // RoomAvailabilityID -> slot
  const [hold, setHoldState] = useState(savedHold) // { reservationId, expiresAt, date, slots }
  const [busy, setBusy] = useState(null) // null | { kind: 'holding', done, total } | { kind: 'confirming' } | { kind: 'releasing' }
  const [receipt, setReceipt] = useState(null) // { reservationId, ranges }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const now = useNow(Boolean(hold))
  const msLeft = hold ? Math.max(0, hold.expiresAt - now) : 0
  const expired = Boolean(hold) && msLeft === 0

  // A ref mirror of `selected` so drag-selection always sees the latest value
  const selectedRef = useRef(selected)
  const dragMode = useRef(null) // 'add' | 'remove' | null

  const commitSelection = (next) => {
    selectedRef.current = next
    setSelected(next)
  }

  const setHold = useCallback(
    (next) => {
      saveHold(user.AppUserID, next)
      setHoldState(next)
    },
    [user.AppUserID],
  )

  const refreshMyBookings = useCallback(async () => {
    const mine = await loadMyReservations(user.AppUserID)
    setBusyKeys(busySlotKeys(mine))
  }, [user.AppUserID])

  // Step 1 - check_room_availability
  const runSearch = useCallback(async (f) => {
    setLoading(true)
    setError('')
    try {
      const data = await api.searchAvailability({
        available_date: f.date,
        start_time: f.from === '' ? undefined : minutesToTime(Number(f.from)),
        end_time: f.to === '' ? undefined : minutesToTime(Number(f.to)),
        floor: f.floor,
        seats: f.seats,
        whiteboard: f.whiteboard,
      })
      // Hide slots that have already ended today
      const isToday = f.date === todayISO()
      const now = nowMinutes()
      const upcoming = isToday ? data.filter((s) => toMinutes(s.EndTime) > now) : data
      setSlots(upcoming)
      setSearchedDate(f.date)
      setFloors((prev) => [...new Set([...prev, ...data.map((s) => s.Floor)])].sort((a, b) => a - b))
      commitSelection(new Map())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    runSearch(initialFilters)
    refreshMyBookings().catch((err) => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSearch, refreshMyBookings])

  // Stop drag-selecting when the mouse button is released anywhere
  useEffect(() => {
    const stop = () => (dragMode.current = null)
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  // When the hold runs out, release it right away instead of waiting for the database to tidy up
  useEffect(() => {
    if (!expired) return
    api.cancelReservation(hold.reservationId).catch(() => {})
  }, [expired, hold])

  // Held slots are no longer "Available", so search results leave them out - add them back to the grid
  const gridSlots = useMemo(() => {
    if (!hold || hold.date !== searchedDate) return slots
    const ids = new Set(slots.map((s) => s.RoomAvailabilityID))
    return [...slots, ...hold.slots.filter((s) => !ids.has(s.RoomAvailabilityID))]
  }, [slots, hold, searchedDate])
  const heldIds = useMemo(() => new Set(hold?.slots.map((s) => s.RoomAvailabilityID) ?? []), [hold])

  // ---------- selecting slots ----------
  function whyCannotAdd(slot, current) {
    if (current.size >= MAX_SLOTS) {
      return `A reservation can include at most ${MAX_SLOTS} time slots (2 hours).`
    }
    const start = toMinutes(slot.StartTime)
    for (const s of current.values()) {
      if (s.RoomID !== slot.RoomID && toMinutes(s.StartTime) === start) {
        return `You can't reserve two rooms at the same time — ${fmtTime(start)} is already selected in ${s.RoomNumber}.`
      }
    }
    return null
  }

  function applyToSlot(slot, mode) {
    const current = selectedRef.current
    const id = slot.RoomAvailabilityID
    if (mode === 'remove') {
      if (!current.has(id)) return
      const next = new Map(current)
      next.delete(id)
      commitSelection(next)
      return
    }
    if (current.has(id)) return
    const problem = whyCannotAdd(slot, current)
    if (problem) {
      setError(problem)
      dragMode.current = null
      return
    }
    setError('')
    commitSelection(new Map(current).set(id, slot))
  }

  function clearMessages() {
    setReceipt(null)
    setNotice('')
  }

  function handleSlotDown(slot) {
    clearMessages()
    dragMode.current = selectedRef.current.has(slot.RoomAvailabilityID) ? 'remove' : 'add'
    applyToSlot(slot, dragMode.current)
  }

  function handleSlotEnter(slot) {
    if (dragMode.current) applyToSlot(slot, dragMode.current)
  }

  function handleSlotKey(slot) {
    clearMessages()
    applyToSlot(slot, selectedRef.current.has(slot.RoomAvailabilityID) ? 'remove' : 'add')
  }

  // ---------- Steps 3-4: start_reservation + hold_slot ----------
  async function handleHold() {
    const chosen = sortByStart(selected.values())
    setBusy({ kind: 'holding', done: 0, total: chosen.length })
    setError('')
    clearMessages()
    try {
      const { reservationId, expiresAt } = await holdSlots(
        user.AppUserID,
        chosen.map((s) => s.RoomAvailabilityID),
        (done) => setBusy({ kind: 'holding', done, total: chosen.length }),
      )
      setHold({ reservationId, expiresAt, date: searchedDate, slots: chosen })
      commitSelection(new Map())
    } catch (err) {
      setError(`Slots not held: ${err.message}`)
      await runSearch(filters)
    } finally {
      setBusy(null)
    }
  }

  // ---------- Step 5: confirm_reservation, then get_reservation_details for the receipt ----------
  async function handleConfirm() {
    const reservationId = hold.reservationId
    setBusy({ kind: 'confirming' })
    setError('')
    try {
      await confirmHold(reservationId)
      const details = await api.reservationDetails(reservationId)
      setReceipt({ reservationId, ranges: groupIntoRanges(details) })
    } catch (err) {
      setError(err.message)
    } finally {
      setHold(null)
      setBusy(null)
      await runSearch(filters)
      await refreshMyBookings().catch(() => {})
    }
  }

  // ---------- Step 6: cancel_reservation releases the held slots ----------
  async function handleRelease() {
    setBusy({ kind: 'releasing' })
    setError('')
    try {
      await api.cancelReservation(hold.reservationId)
      setNotice('Hold released. Those slots are open to everyone again.')
    } catch (err) {
      setError(err.message)
    } finally {
      setHold(null)
      setBusy(null)
      await runSearch(filters)
    }
  }

  async function handleChooseAgain() {
    setHold(null)
    await runSearch(filters)
  }

  // ---------- filters ----------
  const update = (field) => (e) => setFilters({ ...filters, [field]: e.target.value })

  function handleSubmit(e) {
    e.preventDefault()
    clearMessages()
    if (filters.from !== '' && filters.to !== '' && Number(filters.to) <= Number(filters.from)) {
      setError('"To" time must be after "From" time.')
      return
    }
    runSearch(filters)
  }

  function handleReset() {
    setFilters(DEFAULT_FILTERS)
    clearMessages()
    runSearch(DEFAULT_FILTERS)
  }

  const selectedList = useMemo(() => [...selected.values()], [selected])
  const roomCount = new Set(slots.map((s) => s.RoomID)).size
  const locked = Boolean(hold) || Boolean(busy)

  let step = 0
  if (receipt) step = STEPS.length
  else if (hold) step = 2
  else if (busy?.kind === 'holding') step = 1

  return (
    <section className="stack-lg">
      <div className="page-head">
        <h1>Find a room</h1>
        <p className="muted">
          Pick up to {MAX_SLOTS} fifteen-minute slots (2 hours). We hold them for {HOLD_MINUTES} minutes while you
          confirm.
        </p>
      </div>

      <Stepper steps={STEPS} current={step} />

      <form className="card filters" onSubmit={handleSubmit}>
        <fieldset className="filters-fieldset" disabled={Boolean(hold)}>
          <label className="field">
            <span>Date</span>
            <input type="date" required value={filters.date} min={todayISO()} onChange={update('date')} />
          </label>
          <label className="field">
            <span>From</span>
            <select value={filters.from} onChange={update('from')}>
              <option value="">Any time</option>
              {timeOptions().slice(0, -1).map((t) => (
                <option key={t} value={t}>
                  {fmtTime(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>To</span>
            <select value={filters.to} onChange={update('to')}>
              <option value="">Any time</option>
              {timeOptions().slice(1).map((t) => (
                <option key={t} value={t}>
                  {fmtTime(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Floor</span>
            <select value={filters.floor} onChange={update('floor')}>
              <option value="">Any floor</option>
              {floors.map((f) => (
                <option key={f} value={f}>
                  Floor {f}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Min. seats</span>
            <input type="number" min="1" max="50" placeholder="Any" value={filters.seats} onChange={update('seats')} />
          </label>
          <label className="field">
            <span>Whiteboard</span>
            <select value={filters.whiteboard} onChange={update('whiteboard')}>
              <option value="">Doesn't matter</option>
              <option value="true">Required</option>
              <option value="false">No whiteboard</option>
            </select>
          </label>
          <div className="filter-actions">
            <button className="btn btn-primary" disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleReset}>
              Reset
            </button>
          </div>
        </fieldset>
      </form>

      <Alert type="error" onClose={() => setError('')}>
        {error}
      </Alert>
      <Alert type="info" onClose={() => setNotice('')}>
        {notice}
      </Alert>
      {receipt && (
        <Alert type="success" onClose={() => setReceipt(null)}>
          <strong>Reservation #{receipt.reservationId} confirmed.</strong> {describeRanges(receipt.ranges)}
          {receipt.ranges[0] && ` on ${fmtDate(receipt.ranges[0].date)}`}.{' '}
          <button className="link" onClick={() => goTo('mine')}>
            View my reservations
          </button>
        </Alert>
      )}

      <div className="card">
        <div className="card-head">
          <h2>{searchedDate ? fmtDate(searchedDate, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Results'}</h2>
          {!loading && searchedDate && (
            <span className="muted small">
              {roomCount} room{roomCount === 1 ? '' : 's'} with open slots
            </span>
          )}
        </div>

        {loading && <p className="muted">Loading available slots…</p>}
        {!loading && searchedDate && gridSlots.length === 0 && (
          <div className="empty">
            <p>
              <strong>No open slots match your search.</strong>
            </p>
            <p className="muted">Try another date, a wider time range, or fewer filters.</p>
          </div>
        )}
        {!loading && gridSlots.length > 0 && (
          <>
            <SlotGrid
              slots={gridSlots}
              date={searchedDate}
              selectedIds={selected}
              heldIds={heldIds}
              locked={locked}
              busyKeys={busyKeys}
              onSlotDown={handleSlotDown}
              onSlotEnter={handleSlotEnter}
              onSlotKey={handleSlotKey}
            />
            <div className="grid-legend">
              <span>
                <i className="swatch cell-open" /> Open
              </span>
              <span>
                <i className="swatch cell-selected" /> Selected
              </span>
              <span>
                <i className="swatch cell-held" /> Held for you
              </span>
              <span>
                <i className="swatch cell-mine" /> You have a room at this time
              </span>
              <span>
                <i className="swatch cell-off" /> Not available
              </span>
              {!hold && <span className="muted">Tip: press and drag across a row to select several slots.</span>}
            </div>
          </>
        )}
      </div>

      {(selectedList.length > 0 || hold || busy?.kind === 'holding') && (
        <BookingBar
          selected={selectedList}
          hold={hold}
          busy={busy}
          msLeft={msLeft}
          expired={expired}
          onClear={() => commitSelection(new Map())}
          onHold={handleHold}
          onConfirm={handleConfirm}
          onRelease={handleRelease}
          onChooseAgain={handleChooseAgain}
        />
      )}
    </section>
  )
}

// Choose -> Hold -> Confirm. `current` is the index of the step in progress
// (steps before it are done; current === steps.length means all done).
function Stepper({ steps, current }) {
  return (
    <ol className="stepper" aria-label="Booking steps">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={label} className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-dot" aria-hidden="true">
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className="step-label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function fmtCountdown(ms) {
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// The floating bar at the bottom of the page. One bar, four states:
// selecting -> holding (in progress) -> held (countdown) -> expired
function BookingBar({ selected, hold, busy, msLeft, expired, onClear, onHold, onConfirm, onRelease, onChooseAgain }) {
  if (busy?.kind === 'holding') {
    return (
      <div className="booking-bar" role="status" aria-live="polite">
        <div className="booking-summary">
          <strong>
            Holding slots… {busy.done} of {busy.total}
          </strong>
          <span className="muted small">Reserving each 15-minute slot so nobody else can take it.</span>
        </div>
        <Progress value={busy.total ? busy.done / busy.total : 0} />
      </div>
    )
  }

  if (hold && expired) {
    return (
      <div className="booking-bar booking-bar-expired" role="region" aria-label="Your hold">
        <div className="booking-summary">
          <strong>Your hold expired</strong>
          <span className="muted small">The slots were released after {HOLD_MINUTES} minutes. Pick them again to book.</span>
        </div>
        <div className="booking-actions">
          <button className="btn btn-primary" onClick={onChooseAgain}>
            Choose again
          </button>
        </div>
      </div>
    )
  }

  if (hold) {
    const ranges = groupIntoRanges(hold.slots)
    const working = Boolean(busy)
    const urgent = msLeft < 60_000
    return (
      <div className="booking-bar booking-bar-held" role="region" aria-label="Your hold">
        <div className="booking-summary">
          <strong>
            Held for you ·{' '}
            <span className={`countdown ${urgent ? 'countdown-urgent' : ''}`} aria-label={`${fmtCountdown(msLeft)} left`}>
              {fmtCountdown(msLeft)}
            </span>{' '}
            left
          </strong>
          <span className="muted small">
            {fmtDuration(hold.slots.length * SLOT_MINUTES)} · {describeRanges(ranges)}
          </span>
        </div>
        <div className="booking-actions">
          <button className="btn btn-ghost" onClick={onRelease} disabled={working}>
            {busy?.kind === 'releasing' ? 'Releasing…' : 'Release'}
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={working}>
            {busy?.kind === 'confirming' ? 'Confirming…' : 'Confirm reservation'}
          </button>
        </div>
        <Progress value={msLeft / (HOLD_MINUTES * 60_000)} tick urgent={urgent} />
      </div>
    )
  }

  const ranges = groupIntoRanges(selected)
  return (
    <div className="booking-bar" role="region" aria-label="Your selection">
      <div className="booking-summary">
        <strong>
          {selected.length} of {MAX_SLOTS} slots · {fmtDuration(selected.length * SLOT_MINUTES)}
        </strong>
        <span className="muted small">{describeRanges(ranges)}</span>
      </div>
      <div className="booking-actions">
        <button className="btn btn-ghost" onClick={onClear}>
          Clear
        </button>
        <button className="btn btn-primary" onClick={onHold}>
          Hold {selected.length === 1 ? 'slot' : `${selected.length} slots`}
        </button>
      </div>
    </div>
  )
}

// A thin bar along the bottom edge of the booking bar. Scaled with transform so it never triggers layout.
// `tick` = the countdown, which moves linearly between once-a-second updates.
function Progress({ value, tick = false, urgent = false }) {
  const scale = Math.min(1, Math.max(0, value))
  return (
    <span className={`booking-progress ${urgent ? 'booking-progress-urgent' : ''}`} aria-hidden="true">
      <span className={`booking-progress-fill ${tick ? 'booking-progress-tick' : ''}`} style={{ transform: `scaleX(${scale})` }} />
    </span>
  )
}
