'use client'

import { memo, type ComponentProps } from 'react'
import { GEQBarView } from './GEQBarView'

interface DesktopGeqPanelProps {
  isRunning: boolean
  onClearGEQ: () => void
  hasActiveGEQBars: boolean
  activeGeqCutCount: number
  geqBarViewProps: ComponentProps<typeof GEQBarView>
}

export const DesktopGeqPanel = memo(function DesktopGeqPanel({
  isRunning,
  onClearGEQ,
  hasActiveGEQBars,
  activeGeqCutCount,
  geqBarViewProps,
}: DesktopGeqPanelProps) {
  return (
    <div className="h-full p-1 pt-0.5">
      <div className="h-full rounded overflow-hidden flex flex-col min-w-0 instrument-window instrument-window-amber noise-panel">
        <div className="flex-shrink-0 flex items-center amber-panel-header panel-header">
          <div className="flex items-center gap-2">
            <div className={isRunning ? 'power-led' : 'power-led-off'} />
            <span
              className="text-dwa-sm font-mono font-bold tracking-[0.2em] uppercase whitespace-nowrap"
              style={{ color: 'var(--console-amber)', opacity: 0.9 }}
            >
              <span className="hidden lg:inline">Graphic Equalizer</span>
              <span className="lg:hidden">GEQ</span>
            </span>
            {hasActiveGEQBars ? (
              <>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-dwa-sm font-mono font-bold leading-none bg-[var(--console-amber)]/15 text-[var(--console-amber)] border border-[var(--console-amber)]/30">
                  {activeGeqCutCount} cuts
                </span>
                <button type="button"
                  onClick={onClearGEQ}
                  className="px-1.5 py-0.5 rounded text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  Clear
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <GEQBarView {...geqBarViewProps} />
        </div>
      </div>
    </div>
  )
})
