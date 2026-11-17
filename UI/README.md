# Study Room Finder — UI

A React app (built with [Vite](https://vite.dev)) for the study-room reservation system. It talks to the FastAPI backend in `../API`.

## Run it locally

1. **Update the database.** Run `DataLayer/DatabaseProgrammingObjects.sql` against your database. It includes:
   - the hold-then-confirm booking procedures: `procStartReservation`, `procHoldSlot`, `procConfirmReservation`, and `procReleaseExpiredHolds`. `procHoldSlot` blocks taken slots, reservations over 2 hours, and two rooms at the same time.
   - `procGetOccupancyStatusForAllRooms`, which returns each room's number, floor, seats, and whiteboard along with its sensor status (used by the **Room status** page)
   - `procGetReservationUsage` and `procGetSensorUsage` for the admin usage page
2. **Start the API** (from the `API` folder):
   ```
   pip install -r requirements.txt
   uvicorn studyroom_sniffer_api:app --reload
   ```
   It runs at http://127.0.0.1:8000. You can try every endpoint at http://127.0.0.1:8000/docs.
3. **Start the UI** (from this `UI` folder; requires Node.js 20+):
   ```
   npm install
   npm run dev
   ```
   Open http://localhost:5173 and sign in with an account from `InsertData.sql`, or create a new one.

If the API runs somewhere else, set `VITE_API_BASE_URL` in `UI/.env` (see `.env.example`).

## Pages and requirements

| Page | Who | What it does |
|---|---|---|
| **Room status** | everyone | Live occupancy of every room from the door sensors: green = vacant, red = occupied. Refreshes every 15 seconds. |
| **Available now** | everyone | Requirement 5: rooms open in the current 15-min slot, how long they stay free, live sensor status, one-click reserve |
| **Find a room** | everyone | Requirements 1, 2, 3, 6, 8: filter by date, time, floor, seats, whiteboard; click or drag to pick 1–8 slots; hold them for 10 minutes, then confirm |
| **My reservations** | everyone | Requirements 4, 7: check in, check out, cancel; confirm or release a hold that is still open |
| **Create availability** | admins | Requirement 9: create 8 AM–8 PM slots for a date range (warns about dates that already exist) |
| **Usage analysis** | admins | Requirement 10: busiest hours, days, and rooms from reservations (planned) or sensor entries (actual) |

The admin tabs only appear when `AppUserRole = 'Admin'`.

## How a reservation is made

Booking is two-phase: the student first **holds** the slots, then **confirms** them. This is the order of API calls:

| # | Endpoint | When the UI calls it |
|---|---|---|
| 1 | `GET /authenticate_user/` | Sign in |
| 2 | `GET /check_room_availability/` | Search on **Find a room**; fills the slot grid |
| 3 | `POST /start_reservation/` | Student clicks **Hold**. Creates a `Pending` reservation and starts the 10-minute clock. |
| 4 | `POST /hold_slot/` | Once per selected slot. Each slot becomes `OnHold`, and the stored procedure enforces the rules. |
| 5 | `POST /confirm_reservation/` | Student clicks **Confirm reservation**. Returns `confirmed: 0` if the hold already expired. |
| 6 | `POST /cancel_reservation/` | Student clicks **Release**; also called automatically if a `hold_slot` call fails partway or the countdown reaches zero. |
| 7 | `GET /get_user_reservations/` | **My reservations**, and to mark times the student is already booked |
| 8 | `GET /get_reservation_details/` | The rooms and times for each reservation, and the receipt shown after confirming |

Some details:

- **Expiry.** Held slots last 10 minutes. The UI shows a countdown, but the database decides: `procReleaseExpiredHolds` runs at the start of every hold and confirm, frees expired holds, and cancels their reservations.
- **All or nothing.** If any slot can't be held (for example, someone else just took it), the UI cancels the whole reservation, so a student never ends up with half a hold. The cancel trigger releases the slots that were already held.
- **Leaving the page.** A hold in progress is kept in `sessionStorage`, so the student can switch tabs and come back to it. It also appears on **My reservations** as *On hold*, with **Confirm** and **Release** buttons.
- **Reserve now.** On **Available now**, the student has already decided, so the UI runs start → hold → confirm in one click.

The UI checks the same rules before sending (max 8 slots, no two rooms at once), so students see the problem right away. The database still has the final say.

## Settings you may want to change

- `src/pages/MyReservations.jsx`: `CHECK_IN_EARLY_MINUTES` (default 15) and `ENFORCE_CHECK_IN_WINDOW`. Set the second one to `false` to allow check-in at any time, which is handy for class demos.
- `src/time.js`: `DAY_START`, `DAY_END`, and `MAX_SLOTS`.
- `src/reservations.js`: `HOLD_MINUTES` (default 10). This only changes the countdown the UI shows. Keep it in step with the 10 minutes in `procReleaseExpiredHolds`.
- `src/pages/RoomStatus.jsx`: `REFRESH_MS`, how often room status refreshes (default 15 seconds).

## Code map

```
src/
  api.js               every call to the FastAPI backend
  reservations.js      loading a user's reservations, hold/confirm helpers, conflict checks
  time.js              date/time formatting and 15-minute slot math
  App.jsx              sign-in state, tabs, and page switching
  components/
    SlotGrid.jsx       rooms x time-slot grid (click or drag to select; shows held slots)
    Charts.jsx         heatmap, column chart, and bar list for usage analysis
    Alert.jsx          success, error, and info messages
  pages/               one file per tab, plus Login.jsx
  styles.css           all styles (supports light and dark mode)
```

## Deploy to Azure

The API runs on an Azure **Web App** (App Service) because it is a Python program that has to keep running. The UI is different: `npm run build` turns it into plain HTML, CSS, and JavaScript files that run in the browser. All it needs is static hosting, and **Azure Static Web Apps** (Free plan) is the best fit.

1. **Point the build at the deployed API.** Vite bakes `VITE_API_BASE_URL` into the files at build time, so set it before building. In `UI/.env`:
   ```
   VITE_API_BASE_URL=https://<your-api-app>.azurewebsites.net
   ```
   Use `https://`. The UI is served over HTTPS, and browsers block calls from it to a plain `http://` API.
2. **Build:**
   ```
   npm run build
   ```
   This writes the site to `dist/`.
3. **Create the Static Web App and deploy.** In VS Code, install the **Azure Static Web Apps** extension. In the Azure panel, choose **Static Web Apps → + Create Static Web App (Advanced)**, pick the **Free** plan and the **React** preset, and set **App location** to `UI` and **Output location** to `dist`.
   - If the project is on GitHub, Azure adds a GitHub Action that rebuilds and redeploys on every push. Add `VITE_API_BASE_URL` to that workflow, because `.env` is not committed.
   - Without GitHub, deploy from this folder with the CLI (it signs you in and asks which app to use):
     ```
     npm install -g @azure/static-web-apps-cli
     swa deploy ./dist --env production
     ```
4. **Allow the UI to call the API (CORS).** In the Azure Portal, open the **API's** Web App and go to **Settings → Environment variables**. Set `UI_ORIGINS` to the UI's URL, comma-separated, keeping localhost if you still develop locally:
   ```
   https://<random-name>.azurestaticapps.net,http://localhost:5173
   ```
   Save, and the API restarts. If you skip this step, every request fails with *"Cannot reach the API"*, and the browser console shows a CORS error.

The app switches tabs with `#hash` URLs, so refreshing on any tab works without extra routing configuration.
