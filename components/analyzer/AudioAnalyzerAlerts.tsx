'use client'

import { memo } from 'react'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { getAudioAnalyzerErrorGuidance } from '@/lib/analyzer/audioAnalyzerErrorGuidance'

interface AudioAnalyzerAlertsProps {
  error: string | null
  workerError: string | null
  isErrorDismissed: boolean
  isWorkerPermanentlyDead: boolean
  onDismissError: () => void
  onRetry: () => void
}

export const AudioAnalyzerAlerts = memo(function AudioAnalyzerAlerts({
  error,
  workerError,
  isErrorDismissed,
  isWorkerPermanentlyDead,
  onDismissError,
  onRetry,
}: AudioAnalyzerAlertsProps) {
  const guidance =
    error == null
      ? null
      : getAudioAnalyzerErrorGuidance(error, {
          protocol: typeof location !== 'undefined' ? location.protocol : undefined,
          hostname: typeof location !== 'undefined' ? location.hostname : undefined,
        })

  return (
    <>
      {error && !isErrorDismissed ? (
        <div
          role="alert"
          className="px-3 py-2 sm:px-4 sm:py-2.5 bg-destructive/10 border-b border-destructive/20 max-h-[40vh] overflow-y-auto"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-mono font-medium text-destructive">{error}</p>
              <p className="text-sm text-muted-foreground font-mono leading-snug">{guidance}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-sm font-mono font-medium bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-destructive/50"
              >
                <RotateCcw className="w-3 h-3" />
                Try Again
              </button>
              <button type="button"
                onClick={onDismissError}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-card/40 transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {workerError ? (
        <div
          role="alert"
          className={`px-3 py-1.5 sm:px-4 sm:py-2 border-b ${
            isWorkerPermanentlyDead
              ? 'bg-red-500/15 border-red-500/40 dark:bg-red-500/10 dark:border-red-500/30'
              : 'bg-amber-500/15 border-amber-500/35 dark:bg-amber-500/5 dark:border-amber-500/20'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              className={`w-3.5 h-3.5 flex-shrink-0 ${isWorkerPermanentlyDead ? 'text-red-500' : 'text-amber-500'}`}
            />
            <p
              className={`text-sm font-mono ${
                isWorkerPermanentlyDead ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {isWorkerPermanentlyDead
                ? 'Analysis engine stopped - detection is offline.'
                : 'Analysis engine hiccup — restarting automatically.'}
            </p>
            <button type="button"
              onClick={onRetry}
              className={`ml-auto text-sm font-mono underline underline-offset-2 flex-shrink-0 transition-colors cursor-pointer outline-none focus-visible:ring-[3px] ${
                isWorkerPermanentlyDead
                  ? 'text-red-400 hover:text-red-300 focus-visible:ring-red-500/50'
                  : 'text-amber-400 hover:text-amber-300 focus-visible:ring-amber-500/50'
              }`}
            >
              Restart
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
})
