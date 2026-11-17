const ICONS = { success: '✓', error: '!', info: 'i', warning: '!' }

// A message box. Status is shown with an icon and text, never color alone.
export default function Alert({ type = 'info', children, onClose }) {
  if (!children) return null
  return (
    <div className={`alert alert-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <span className="alert-icon" aria-hidden="true">
        {ICONS[type]}
      </span>
      <div className="alert-body">{children}</div>
      {onClose && (
        <button className="alert-close" onClick={onClose} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}
