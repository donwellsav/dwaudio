'use client'

import { memo, type ComponentProps, type ReactNode, type Ref } from 'react'
import { Expand, Shrink } from 'lucide-react'
import { GEQBarView } from '@/components/analyzer/GEQBarView'
import {
  MobileGraphModeToggle,
  MobileSpectrumGraph,
  type GraphMode,
  type SpectrumCanvasProps,
} from '@/components/analyzer/MobileLayoutCommon'

type GeqBarViewProps = ComponentProps<typeof GEQBarView>

interface MobileLandscapeLayoutProps {
  activeAdvisoryCount: number
  geqProps: GeqBarViewProps
  hasActiveGEQBars: boolean
  hasActiveRTAMarkers: boolean
  inlineGraphMode: GraphMode
  isFrozen: boolean
  isRtaFullscreen: boolean
  isRunning: boolean
  issuesContent: ReactNode
  landscapePanel: 'issues' | 'settings'
  landscapeRtaProps: SpectrumCanvasProps
  onClearGEQ: () => void
  onClearRTA: () => void
  rtaContainerRef: Ref<HTMLDivElement>
  setInlineGraphMode: (mode: GraphMode) => void
  setLandscapePanel: (panel: 'issues' | 'settings') => void
  settingsContent: ReactNode
  sidecarFader: ReactNode
  toggleFreeze: () => void
  toggleRtaFullscreen: () => void
}

export const MobileLandscapeLayout = memo(function MobileLandscapeLayout({
  activeAdvisoryCount,
  geqProps,
  hasActiveGEQBars,
  hasActiveRTAMarkers,
  inlineGraphMode,
  isFrozen,
  isRtaFullscreen,
  isRunning,
  issuesContent,
  landscapePanel,
  landscapeRtaProps,
  onClearGEQ,
  onClearRTA,
  rtaContainerRef,
  setInlineGraphMode,
  setLandscapePanel,
  settingsContent,
  sidecarFader,
  toggleFreeze,
  toggleRtaFullscreen,
}: MobileLandscapeLayoutProps) {
  return (
    <div className="hidden landscape:flex xl:landscape:hidden flex-1 overflow-hidden">
      <div
        className={`${landscapePanel === 'settings' ? 'w-[52%]' : 'w-[40%]'} flex min-w-0 flex-col overflow-hidden border-r border-border/50 transition-[width] duration-200`}
      >
        <div
          className="flex-shrink-0 flex items-center border-b border-border/40 bg-card/30"
          role="tablist"
          aria-label="Landscape panel"
        >
          <button type="button"
            role="tab"
            aria-selected={landscapePanel === 'issues'}
            onClick={() => setLandscapePanel('issues')}
            className={`flex-1 py-1.5 text-dwa-sm font-mono font-bold uppercase tracking-wider text-center cursor-pointer transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
              landscapePanel === 'issues'
                ? 'text-[var(--console-amber)] bg-[var(--console-amber)]/10'
                : 'text-muted-foreground/50 hover:text-foreground'
            }`}
          >
            Issues{' '}
            {activeAdvisoryCount > 0 ? (
              <span className="text-[var(--console-amber)]">{activeAdvisoryCount}</span>
            ) : null}
          </button>
          <button type="button"
            role="tab"
            aria-selected={landscapePanel === 'settings'}
            onClick={() => setLandscapePanel('settings')}
            className={`flex-1 py-1.5 text-dwa-sm font-mono font-bold uppercase tracking-wider text-center cursor-pointer transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
              landscapePanel === 'settings'
                ? 'text-[var(--console-amber)] bg-[var(--console-amber)]/10'
                : 'text-muted-foreground/50 hover:text-foreground'
            }`}
          >
            Settings
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {landscapePanel === 'issues' ? issuesContent : settingsContent}
        </div>
      </div>

      <div
        className={`${landscapePanel === 'settings' ? 'w-[42%]' : 'w-[54%]'} flex min-w-0 flex-col overflow-hidden p-0.5 transition-[width] duration-200`}
      >
        <div className="flex-shrink-0 flex items-center gap-1 px-1 pb-0.5">
          <MobileGraphModeToggle
            mode={inlineGraphMode}
            onModeChange={setInlineGraphMode}
            buttonClassName="px-2 py-0.5 text-dwa-sm"
          />
          {inlineGraphMode === 'rta' ? (
            <>
              <button type="button"
                onClick={toggleRtaFullscreen}
                className="cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 p-1 rounded text-muted-foreground/60 hover:text-foreground transition-colors"
                aria-label={isRtaFullscreen ? 'Collapse RTA' : 'Expand RTA'}
              >
                {isRtaFullscreen ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
              </button>
              {isRunning ? (
                <button type="button"
                  onClick={toggleFreeze}
                  className={`cursor-pointer outline-none text-dwa-sm font-mono font-bold uppercase px-1.5 py-0.5 rounded transition-colors ${
                    isFrozen ? 'text-blue-400' : 'text-muted-foreground/50 hover:text-foreground'
                  }`}
                >
                  {isFrozen ? 'Live' : 'Freeze'}
                </button>
              ) : null}
              {hasActiveRTAMarkers ? (
                <button type="button"
                  onClick={onClearRTA}
                  className="cursor-pointer text-dwa-sm font-mono text-muted-foreground/50 hover:text-foreground px-1.5 py-0.5 rounded transition-colors"
                >
                  Clear
                </button>
              ) : null}
            </>
          ) : null}
          {inlineGraphMode === 'geq' && hasActiveGEQBars ? (
            <button type="button"
              onClick={onClearGEQ}
              className="cursor-pointer text-dwa-sm font-mono text-muted-foreground/50 hover:text-foreground px-1.5 py-0.5 rounded transition-colors"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="flex-1 min-h-0 bg-card/40 rounded border border-border/40 overflow-hidden">
          {inlineGraphMode === 'rta' ? (
            <MobileSpectrumGraph spectrumProps={landscapeRtaProps} containerRef={rtaContainerRef} />
          ) : (
            <GEQBarView {...geqProps} />
          )}
        </div>
      </div>

      <div className="w-[6%] min-w-[3.5rem] flex-shrink-0 border-l border-border bg-card/30 channel-strip flex flex-col">
        {sidecarFader}
      </div>
    </div>
  )
})
