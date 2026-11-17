// All calls to the FastAPI backend live in this one file.
// The backend reads parameters from the query string, so every call sends them that way.

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

async function request(method, path, params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.append(key, value)
  }
  const url = `${API_BASE_URL}${path}${query.toString() ? `?${query}` : ''}`

  let response
  try {
    response = await fetch(url, { method })
  } catch {
    throw new Error(`Cannot reach the API at ${API_BASE_URL}. Is the FastAPI server running?`)
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    // some error responses have no JSON body
  }

  if (!response.ok) {
    let detail = body?.detail
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join('; ') // FastAPI validation errors
    throw new Error(detail || `Request failed (${response.status})`)
  }
  return body
}

export const api = {
  // ----- users -----
  login: (email, password) =>
    request('GET', '/authenticate_user/', { email, password }).then((r) => r.data),

  register: ({ firstName, lastName, email, password }) =>
    request('POST', '/register_user/', {
      first_name: firstName,
      last_name: lastName,
      email,
      password,
    }),

  // ----- rooms -----
  // filters: { available_date, start_time, end_time, floor, seats, whiteboard }
  searchAvailability: (filters = {}) =>
    request('GET', '/check_room_availability/', filters).then((r) => r.data),

  occupancy: () => request('GET', '/get_occupancy_status_for_all_rooms/').then((r) => r.data),

  // ----- reservations -----
  // Booking workflow: start_reservation -> hold_slot (once per slot) -> confirm_reservation
  // (or cancel_reservation to release). Held slots expire after 10 minutes.
  startReservation: (appUserId) =>
    request('POST', '/start_reservation/', { app_user_id: appUserId }).then((r) => r.reservation_id),

  holdSlot: (reservationId, roomAvailabilityId) =>
    request('POST', '/hold_slot/', {
      reservation_id: reservationId,
      room_availability_id: roomAvailabilityId,
    }),

  // Resolves to true when confirmed, false when the hold had already expired
  confirmReservation: (reservationId) =>
    request('POST', '/confirm_reservation/', { reservation_id: reservationId }).then((r) => Boolean(r.confirmed)),

  userReservations: (appUserId) =>
    request('GET', '/get_user_reservations/', { app_user_id: appUserId }).then((r) => r.data),

  reservationDetails: (reservationId) =>
    request('GET', '/get_reservation_details/', { reservation_id: reservationId }).then((r) => r.data),

  cancelReservation: (reservationId) =>
    request('POST', '/cancel_reservation/', { reservation_id: reservationId }),

  checkIn: (reservationId) => request('POST', '/check_in/', { reservation_id: reservationId }),

  checkOut: (reservationId) => request('POST', '/check_out/', { reservation_id: reservationId }),

  // ----- admin -----
  createAvailability: (startDate, endDate) =>
    request('POST', '/create_room_availability_between_dates/', {
      start_date: startDate,
      end_date: endDate,
    }),

  usageStatistics: (startDate, endDate) =>
    request('GET', '/get_usage_statistics/', { start_date: startDate, end_date: endDate }),
}
