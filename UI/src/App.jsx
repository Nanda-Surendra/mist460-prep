import { useEffect, useState } from 'react'
import Login from './pages/Login.jsx'
import AvailableNow from './pages/AvailableNow.jsx'
import RoomStatus from './pages/RoomStatus.jsx'
import FindRoom from './pages/FindRoom.jsx'
import MyReservations from './pages/MyReservations.jsx'
import AdminAvailability from './pages/AdminAvailability.jsx'
import AdminUsage from './pages/AdminUsage.jsx'

const USER_KEY = 'studyroom.user'

const STUDENT_TABS = [
  { id: 'status', label: 'Room status', Page: RoomStatus },
  { id: 'now', label: 'Available now', Page: AvailableNow },
  { id: 'find', label: 'Find a room', Page: FindRoom },
  { id: 'mine', label: 'My reservations', Page: MyReservations },
]
const ADMIN_TABS = [
  { id: 'availability', label: 'Create availability', Page: AdminAvailability },
  { id: 'usage', label: 'Usage analysis', Page: AdminUsage },
]

function loadSavedUser() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY))
  } catch {
    return null
  }
}

const currentHash = () => window.location.hash.replace('#', '')

export default function App() {
  const [user, setUser] = useState(loadSavedUser)
  const [tabId, setTabId] = useState(currentHash)

  // The tab lives in the URL hash so the browser's back button and refresh work.
  useEffect(() => {
    const onHashChange = () => setTabId(currentHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function handleLogin(u) {
    try {
      sessionStorage.setItem(USER_KEY, JSON.stringify(u))
    } catch {
      // storage blocked - the user just stays signed in until refresh
    }
    setUser(u)
  }

  function handleLogout() {
    try {
      sessionStorage.removeItem(USER_KEY)
    } catch {
      // ignore
    }
    setUser(null)
    window.location.hash = ''
  }

  if (!user) return <Login onLogin={handleLogin} />

  const isAdmin = user.AppUserRole === 'Admin'
  const tabs = isAdmin ? [...STUDENT_TABS, ...ADMIN_TABS] : STUDENT_TABS
  const active = tabs.find((t) => t.id === tabId) ?? tabs[0]
  const goTo = (id) => (window.location.hash = id)

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            <span>Study Room Finder</span>
          </div>
          <div className="user-chip">
            <span>
              {user.FirstName} {user.LastName}
            </span>
            {isAdmin && <span className="badge badge-admin">Admin</span>}
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="Main">
          {tabs.map((t, i) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className={`tab ${t.id === active.id ? 'active' : ''} ${isAdmin && i === STUDENT_TABS.length ? 'tab-divider' : ''}`}
              aria-current={t.id === active.id ? 'page' : undefined}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="page">
        <active.Page key={active.id} user={user} goTo={goTo} />
      </main>
    </div>
  )
}
