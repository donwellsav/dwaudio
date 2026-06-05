'use client'

import { memo } from 'react'
import { Spinner } from '@/components/ui/spinner'

interface SpectrumCanvasOverlayProps {
  showIdleStartOverlay: boolean
  isStarting?: boolean
  error?: string | null
  isRunning: boolean
  onStart?: () => void
}

export const SpectrumCanvasOverlay = memo(function SpectrumCanvasOverlay({
  showIdleStartOverlay,
  isStarting = false,
  error,
  isRunning,
  onStart,
}: SpectrumCanvasOverlayProps) {
  if (showIdleStartOverlay) {
    return (
      <div className="absolute inset-0">
        <div
          className={`absolute inset-0 flex items-center justify-center ${onStart ? 'cursor-pointer' : 'pointer-events-none'}`}
          onClick={onStart}
          role={onStart ? 'button' : undefined}
          aria-label={onStart ? (error ? 'Retry analysis' : 'Start analysis') : undefined}
          tabIndex={onStart ? 0 : undefined}
          onKeyDown={onStart ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onStart()
            }
          } : undefined}
        >
          {isStarting ? (
            <span className="flex items-center gap-2.5 px-5 py-3 rounded bg-card/80 backdrop-blur-sm pointer-events-none">
              <Spinner className="size-5 text-[var(--console-amber)]" />
              <span className="text-sm text-neutral-300 font-mono font-medium">Requesting microphone...</span>
            </span>
          ) : error ? (
            <span className="flex flex-col items-center gap-1.5 px-5 py-3 rounded bg-card/80 backdrop-blur-sm pointer-events-none">
              <span className="flex items-center gap-1.5 text-sm text-destructive font-mono font-medium">
                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" x2="12" y1="9" y2="13" />
                  <line x1="12" x2="12.01" y1="17" y2="17" />
                </svg>
                Mic unavailable
              </span>
              <span className="text-sm text-neutral-400 font-mono">Tap to retry</span>
            </span>
          ) : (
            <span className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.20)] bg-card/90 text-sm text-foreground/90 font-mono font-bold tracking-wide backdrop-blur-md shadow-lg pointer-events-none animate-start-glow">
              Press
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.45)] bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.10)] flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-[var(--console-amber)]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.31-2.5-4.06v8.12c1.48-.75 2.5-2.29 2.5-4.06zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              </span>
              To Begin Analysis
            </span>
          )}
        </div>
      </div>
    )
  }

  if (!error || isRunning) return null

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-card/80 backdrop-blur-sm text-sm text-destructive font-mono font-medium">
        <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" x2="12" y1="9" y2="13" />
          <line x1="12" x2="12.01" y1="17" y2="17" />
        </svg>
        Mic error - see banner above
      </span>
    </div>
  )
})
