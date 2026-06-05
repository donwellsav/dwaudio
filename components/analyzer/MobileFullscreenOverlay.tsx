'use client'

import { memo, type ComponentProps } from 'react'
import { Shrink } from 'lucide-react'
import { GEQBarView } from '@/components/analyzer/GEQBarView'
import { MobileSpectrumGraph, type SpectrumCanvasProps } from '@/components/analyzer/MobileLayoutCommon'

type GeqBarViewProps = ComponentProps<typeof GEQBarView>

interface MobileFullscreenOverlayProps {
  fullscreenRtaProps: SpectrumCanvasProps
  geqProps: GeqBarViewProps
  toggleRtaFullscreen: () => void
}

export const MobileFullscreenOverlay = memo(function MobileFullscreenOverlay({
  fullscreenRtaProps,
  geqProps,
  toggleRtaFullscreen,
}: MobileFullscreenOverlayProps) {
  return (
    <div className="landscape:hidden xl:hidden fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-card/90">
        <span className="text-xs font-mono font-bold tracking-[0.15em] uppercase text-muted-foreground">
          Real-Time Analyzer + Graphic Equalizer
        </span>
        <button
          onClick={toggleRtaFullscreen}
          className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          aria-label="Collapse RTA"
        >
          <Shrink className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col gap-0.5 p-0.5">
        <div className="flex-1 min-h-0 bg-card/40 rounded border border-border/40 overflow-hidden">
          <MobileSpectrumGraph spectrumProps={fullscreenRtaProps} />
        </div>
        <div className="flex-1 min-h-0 bg-card/40 rounded border border-border/40 overflow-hidden">
          <GEQBarView {...geqProps} />
        </div>
      </div>
    </div>
  )
})
