'use client'

import { memo, type ComponentProps, type Ref } from 'react'
import { Expand, Shrink } from 'lucide-react'
import { ErrorBoundary } from './ErrorBoundary'
import { SpectrumCanvas } from './SpectrumCanvas'

interface DesktopRtaPanelProps {
  rtaContainerRef: Ref<HTMLDivElement>
  isRunning: boolean
  noiseFloorDb: number | null
  isFrozen: boolean
  isRtaFullscreen: boolean
  toggleFreeze: () => void
  toggleRtaFullscreen: () => void
  onClearRTA: () => void
  hasActiveRTAMarkers: boolean
  spectrumCanvasProps: ComponentProps<typeof SpectrumCanvas>
}

export const DesktopRtaPanel = memo(function DesktopRtaPanel({
  rtaContainerRef,
  isRunning,
  noiseFloorDb,
  isFrozen,
  isRtaFullscreen,
  toggleFreeze,
  toggleRtaFullscreen,
  onClearRTA,
  hasActiveRTAMarkers,
  spectrumCanvasProps,
}: DesktopRtaPanelProps) {
  return (
    <div className="h-full p-1 pb-0.5">
      <div
        ref={rtaContainerRef}
        className="h-full rounded overflow-hidden flex flex-col instrument-window instrument-window-amber noise-panel"
      >
        <div className="flex-shrink-0 flex items-center justify-between amber-panel-header panel-header">
          <div className="flex items-center gap-2">
            <div className={isRunning ? 'power-led' : 'power-led-off'} />
            <span
              className="text-dwa-sm font-mono font-bold tracking-[0.2em] uppercase whitespace-nowrap"
              style={{ color: 'var(--console-amber)', opacity: 0.9 }}
            >
              <span className="hidden lg:inline">Real-Time Analyzer</span>
              <span className="lg:hidden">RTA</span>
            </span>
            {isRunning ? (
              <button type="button"
                onClick={toggleFreeze}
                className={`px-1.5 py-0.5 rounded text-sm font-medium transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                  isFrozen ? 'text-blue-400' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {isFrozen ? 'Live' : 'Freeze'}
              </button>
            ) : null}
            {hasActiveRTAMarkers ? (
              <button type="button"
                onClick={onClearRTA}
                className="px-1.5 py-0.5 rounded text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Clear
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <span
              className="text-sm font-mono whitespace-nowrap"
              style={{ color: 'var(--console-amber)', opacity: 0.6 }}
            >
              {isRunning && noiseFloorDb != null ? `${noiseFloorDb.toFixed(0)}dB` : 'Ready'}
            </span>
            <button type="button"
              onClick={toggleRtaFullscreen}
              className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-label={isRtaFullscreen ? 'Collapse RTA' : 'Expand RTA'}
            >
              {isRtaFullscreen ? <Shrink className="w-5 h-5" /> : <Expand className="w-5 h-5" />}
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <ErrorBoundary>
            <SpectrumCanvas {...spectrumCanvasProps} />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
})
