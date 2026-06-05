'use client'

import { memo, type ComponentProps, type ReactNode, type Ref, type TouchEvent } from 'react'
import { Expand } from 'lucide-react'
import { GEQBarView } from '@/components/analyzer/GEQBarView'
import {
  MobileGraphModeToggle,
  MobileSpectrumGraph,
  type GraphMode,
  type SpectrumCanvasProps,
} from '@/components/analyzer/MobileLayoutCommon'
import type { MobileTabId } from '@/hooks/useMobileTabNavigation'

type GeqBarViewProps = ComponentProps<typeof GEQBarView>

interface MobilePortraitLayoutProps {
  graphHeightVh: number
  geqProps: GeqBarViewProps
  inlineGraphMode: GraphMode
  issuesContent: ReactNode
  mobileTab: MobileTabId
  onGraphTouchEnd: (event: TouchEvent<HTMLDivElement>) => void
  onGraphTouchStart: (event: TouchEvent<HTMLDivElement>) => void
  onResizeEnd: () => void
  onResizeMove: (event: TouchEvent<HTMLDivElement>) => void
  onResizeStart: (event: TouchEvent<HTMLDivElement>) => void
  onTouchEnd: (event: TouchEvent<HTMLDivElement>) => void
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void
  portraitRtaProps: SpectrumCanvasProps
  rtaContainerRef: Ref<HTMLDivElement>
  settingsContent: ReactNode
  setInlineGraphMode: (mode: GraphMode) => void
  sidecarFader: ReactNode
  tabIndex: number
  toggleRtaFullscreen: () => void
  nudgeGraphHeight: (deltaVh: number) => void
}

export const MobilePortraitLayout = memo(function MobilePortraitLayout({
  graphHeightVh,
  geqProps,
  inlineGraphMode,
  issuesContent,
  mobileTab,
  onGraphTouchEnd,
  onGraphTouchStart,
  onResizeEnd,
  onResizeMove,
  onResizeStart,
  onTouchEnd,
  onTouchStart,
  portraitRtaProps,
  rtaContainerRef,
  settingsContent,
  setInlineGraphMode,
  sidecarFader,
  tabIndex,
  toggleRtaFullscreen,
  nudgeGraphHeight,
}: MobilePortraitLayoutProps) {
  return (
    <div className="landscape:hidden xl:hidden flex-1 flex overflow-hidden">
      <div
        className="flex-1 flex flex-col overflow-hidden min-w-0"
        style={{ touchAction: 'pan-y' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex-1 min-h-0 flex transition-transform duration-200 ease-out will-change-transform"
          style={{ transform: `translateX(-${tabIndex * 100}%)` }}
        >
          <div
            id="mobile-tabpanel-issues"
            className="w-full flex-shrink-0 h-full flex flex-col overflow-hidden bg-background"
            role="tabpanel"
            aria-labelledby="mobile-tab-issues"
            aria-hidden={mobileTab !== 'issues'}
            inert={mobileTab !== 'issues' || undefined}
          >
            <div
              className="flex-shrink-0 relative bg-card/40 rounded-sm border-b border-border/40 overflow-hidden"
              style={{ height: `${graphHeightVh}vh` }}
              onTouchStart={onGraphTouchStart}
              onTouchEnd={onGraphTouchEnd}
            >
              <div className="absolute top-0.5 left-0.5 z-20">
                <MobileGraphModeToggle mode={inlineGraphMode} onModeChange={setInlineGraphMode} />
              </div>

              <button
                onClick={toggleRtaFullscreen}
                className="absolute top-0.5 right-0.5 z-20 p-1 rounded text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                aria-label="Expand RTA"
              >
                <Expand className="w-3.5 h-3.5" />
              </button>

              {inlineGraphMode === 'rta' ? (
                <MobileSpectrumGraph
                  spectrumProps={portraitRtaProps}
                  containerRef={rtaContainerRef}
                  wrapInErrorBoundary
                />
              ) : (
                <GEQBarView {...geqProps} />
              )}
            </div>

            <div
              className="flex-shrink-0 flex items-center justify-center min-h-[44px] cursor-row-resize touch-none active:bg-muted/30 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              onTouchStart={onResizeStart}
              onTouchMove={onResizeMove}
              onTouchEnd={onResizeEnd}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  nudgeGraphHeight(3)
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  nudgeGraphHeight(-3)
                }
              }}
              role="slider"
              aria-label="Graph height"
              aria-orientation="vertical"
              aria-valuemin={8}
              aria-valuemax={40}
              aria-valuenow={graphHeightVh}
              aria-valuetext={`${graphHeightVh}% viewport height`}
              tabIndex={0}
            >
              <div className="flex flex-col items-center gap-[3px]">
                <div className="w-8 h-[2px] rounded-full bg-muted-foreground/30" />
                <div className="w-8 h-[2px] rounded-full bg-muted-foreground/30" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">{issuesContent}</div>
          </div>

          <div
            id="mobile-tabpanel-settings"
            className="w-full flex-shrink-0 h-full flex flex-col overflow-hidden bg-background"
            role="tabpanel"
            aria-labelledby="mobile-tab-settings"
            aria-hidden={mobileTab !== 'settings'}
            inert={mobileTab !== 'settings' || undefined}
          >
            <div className="flex-1 overflow-y-auto p-2 space-y-2 scroll-fade-bottom">{settingsContent}</div>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 w-14 min-[375px]:w-16 border-l border-border bg-card/30 channel-strip flex flex-col overflow-hidden">
        {sidecarFader}
      </div>
    </div>
  )
})
