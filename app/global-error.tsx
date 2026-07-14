'use client'

import { useEffect } from 'react'
import { logError } from '@/lib/utils/logger'

const STYLES = `
html { color-scheme: dark light; }
.ge-root {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  min-height: 100vh; padding: 1rem;
  font-family: ui-monospace, monospace;
  background: #0a0a0a; color: #fafafa;
}
.ge-title { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; }
.ge-msg { font-size: 0.875rem; color: #a1a1aa; margin-bottom: 1rem; text-align: center; max-width: 50ch; }
.ge-btn {
  padding: 0.5rem 1rem; font-size: 0.875rem;
  font-family: ui-monospace, monospace; font-weight: 500;
  border-radius: 5px;
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.4);
  cursor: pointer;
}
.ge-btn:focus-visible {
  outline: 3px solid #ef4444;
  outline-offset: 2px;
}
@media (prefers-color-scheme: light) {
  .ge-root { background: #fafafa; color: #0a0a0a; }
  .ge-msg { color: #52525b; }
  .ge-btn {
    background: rgba(220, 38, 38, 0.1);
    color: #b91c1c;
    border-color: rgba(185, 28, 28, 0.4);
  }
  .ge-btn:focus-visible {
    outline-color: #b91c1c;
  }
}
`

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logError(error)
  }, [error])

  return (
    <html>
      <body>
        <style>{STYLES}</style>
        <div className="ge-root">
          <h2 className="ge-title">Something went wrong</h2>
          <p className="ge-msg">{error.message || 'An unexpected error occurred.'}</p>
          <button type="button" onClick={reset} className="ge-btn">Try again</button>
        </div>
      </body>
    </html>
  )
}
