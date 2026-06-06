'use client'

import { memo } from 'react'

interface HeaderBarTransportControlsProps {
  isRunning: boolean
  isStarting: boolean
  isFrozen: boolean
  hasClearableContent: boolean
  onToggleAnalysis: () => void
  onToggleFreeze: () => void
  onClearDisplays: () => void
}

export const HeaderBarTransportControls = memo(function HeaderBarTransportControls({
  isRunning,
  isStarting,
  isFrozen,
  hasClearableContent,
  onToggleAnalysis,
  onToggleFreeze,
  onClearDisplays,
}: HeaderBarTransportControlsProps) {
  return (
    <div className="flex items-center gap-1 tablet:gap-2 flex-shrink-0">
      <button type="button"
        onClick={onToggleAnalysis}
        disabled={isStarting}
        aria-label={isRunning ? 'Stop analysis' : isStarting ? 'Starting analysis' : 'Engage analysis'}
        className={`
          inline-flex items-center justify-center
          relative min-w-[70px] tablet:min-w-[120px] h-11 px-2.5 tablet:px-5
          font-mono text-dwa-sm tablet:text-xs font-bold uppercase tracking-[0.2em] tablet:tracking-[0.3em]
          rounded-md cursor-pointer
          border transition-all duration-200
          focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary
          ${
            isRunning
              ? 'bg-red-100/80 border-red-300 text-red-700 shadow-[inset_0_1px_3px_rgba(0,0,0,0.1)] hover:border-red-400 dark:bg-red-950/50 dark:border-red-500/40 dark:text-red-400 dark:shadow-[inset_0_1px_4px_rgba(0,0,0,0.4),0_0_12px_rgba(239,68,68,0.15)] dark:hover:border-red-400/70 dark:hover:shadow-[inset_0_1px_4px_rgba(0,0,0,0.4),0_0_16px_rgba(239,68,68,0.25)]'
              : isStarting
                ? 'cursor-wait bg-muted/60 border-muted-foreground/20 text-muted-foreground opacity-70'
              : 'bg-emerald-100/80 border-emerald-300 text-emerald-700 shadow-[inset_0_1px_3px_rgba(0,0,0,0.1)] hover:border-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-500/30 dark:text-emerald-400 dark:shadow-[inset_0_1px_4px_rgba(0,0,0,0.4),0_0_8px_rgba(52,211,153,0.1)] dark:hover:border-emerald-400/60 dark:hover:shadow-[inset_0_1px_4px_rgba(0,0,0,0.4),0_0_16px_rgba(52,211,153,0.2)]'
          }
        `}
      >
        {isRunning ? 'STOP' : isStarting ? 'WAIT' : 'ENGAGE'}
      </button>

      {isRunning && (
        <button type="button"
          onClick={onToggleFreeze}
          aria-label={isFrozen ? 'Unfreeze spectrum' : 'Freeze spectrum'}
          aria-pressed={isFrozen}
          className={`
            hidden min-[420px]:inline-flex items-center justify-center
            relative min-w-[60px] tablet:min-w-[100px] h-11 px-2 tablet:px-4
            font-mono text-dwa-sm tablet:text-xs font-bold uppercase tracking-[0.2em] tablet:tracking-[0.3em]
            rounded-md cursor-pointer
            border transition-all duration-200
            focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary
            ${
              isFrozen
                ? 'bg-amber-100/80 border-amber-300 text-amber-700 shadow-[inset_0_1px_3px_rgba(0,0,0,0.1)] hover:border-amber-400 dark:bg-amber-950/40 dark:border-amber-500/40 dark:text-amber-400 dark:shadow-[inset_0_1px_4px_rgba(0,0,0,0.4),0_0_12px_rgba(245,158,11,0.15)] dark:hover:border-amber-400/70 dark:hover:shadow-[inset_0_1px_4px_rgba(0,0,0,0.4),0_0_16px_rgba(245,158,11,0.25)]'
                : 'bg-blue-100/80 border-blue-300 text-blue-700 shadow-[inset_0_1px_3px_rgba(0,0,0,0.1)] hover:border-blue-400 dark:bg-blue-950/30 dark:border-blue-500/30 dark:text-blue-400 dark:shadow-[inset_0_1px_4px_rgba(0,0,0,0.4),0_0_8px_rgba(75,146,255,0.1)] dark:hover:border-blue-400/60 dark:hover:shadow-[inset_0_1px_4px_rgba(0,0,0,0.4),0_0_16px_rgba(75,146,255,0.2)]'
            }
          `}
        >
          {isFrozen ? 'RESUME' : 'PAUSE'}
        </button>
      )}

      <button type="button"
        onClick={onClearDisplays}
        disabled={!hasClearableContent}
        aria-label="Clear all advisories, GEQ, and RTA markers"
        className={`
          hidden min-[420px]:inline-flex items-center justify-center
          relative min-w-[55px] tablet:min-w-[90px] h-11 px-2 tablet:px-4
          font-mono text-dwa-sm tablet:text-xs font-bold uppercase tracking-[0.2em] tablet:tracking-[0.3em]
          rounded-md
          border transition-all duration-200
          focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary
          ${
            hasClearableContent
              ? 'cursor-pointer bg-rose-100/80 border-rose-300 text-rose-700 shadow-[inset_0_1px_3px_rgba(0,0,0,0.1)] hover:border-rose-400 dark:bg-rose-950/30 dark:border-rose-500/30 dark:text-rose-400 dark:shadow-[inset_0_1px_4px_rgba(0,0,0,0.4),0_0_8px_rgba(244,63,94,0.1)] dark:hover:border-rose-400/60 dark:hover:shadow-[inset_0_1px_4px_rgba(0,0,0,0.4),0_0_16px_rgba(244,63,94,0.2)]'
              : 'cursor-default bg-muted/30 border-border/30 text-muted-foreground/25 dark:bg-muted/10 dark:border-border/20 dark:text-muted-foreground/20'
          }
        `}
      >
        CLEAR
      </button>
    </div>
  )
})
