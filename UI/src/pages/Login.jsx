import { useState } from 'react'
import { api } from '../api.js'
import Alert from '../components/Alert.jsx'

const EMPTY = { firstName: '', lastName: '', email: '', password: '', confirm: '' }

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('signin') // 'signin' | 'register'
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (mode === 'register' && form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'register') {
        await api.register(form)
      }
      const user = await api.login(form.email.trim(), form.password)
      onLogin({ ...user, AppUserEmail: form.email.trim() })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next) {
    setMode(next)
    setError('')
  }

  return (
    <div className="login-screen">
      <div className="login-card card">
        <div className="brand brand-lg">
          <img src="/favicon.svg" alt="" width="36" height="36" />
          <span>Study Room Finder</span>
        </div>
        <p className="muted">Find, reserve, and check in to study rooms.</p>

        <div className="segmented" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'signin'}
            className={mode === 'signin' ? 'active' : ''}
            onClick={() => switchMode('signin')}
          >
            Sign in
          </button>
          <button
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => switchMode('register')}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="stack">
          {mode === 'register' && (
            <div className="row-2">
              <label className="field">
                <span>First name</span>
                <input required value={form.firstName} onChange={update('firstName')} autoComplete="given-name" />
              </label>
              <label className="field">
                <span>Last name</span>
                <input required value={form.lastName} onChange={update('lastName')} autoComplete="family-name" />
              </label>
            </div>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" required value={form.email} onChange={update('email')} autoComplete="email" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              required
              value={form.password}
              onChange={update('password')}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </label>
          {mode === 'register' && (
            <label className="field">
              <span>Confirm password</span>
              <input type="password" required value={form.confirm} onChange={update('confirm')} autoComplete="new-password" />
            </label>
          )}

          <Alert type="error">{error}</Alert>

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
