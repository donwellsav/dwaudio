'use client'

import { memo } from 'react'
import type { ComponentProps, Ref } from 'react'
import type { GEQBarView } from './GEQBarView'
import type { SpectrumCanvas } from './SpectrumCanvas'
import { DesktopGeqPanel } from './DesktopGeqPanel'
import { DesktopRtaPanel } from './DesktopRtaPanel'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'

interface DesktopGraphPanelsProps {
  defaultSize?: string
  rtaContainerRef: Ref<HTMLDivElement>
  isRunning: boolean
  noiseFloorDb: number | null
  isFrozen: boolean
  isRtaFullscreen: boolean
  toggleFreeze: () => void
  toggleRtaFullscreen: () => void
  onClearRTA: () => void
  onClearGEQ: () => void
  hasActiveRTAMarkers: boolean
  hasActiveGEQBars: boolean
  activeGeqCutCount: number
  spectrumCanvasProps: ComponentProps<typeof SpectrumCanvas>
  geqBarViewProps: ComponentProps<typeof GEQBarView>
}

export const DesktopGraphPanels = memo(function DesktopGraphPanels({
  defaultSize = '84%',
  rtaContainerRef,
  isRunning,
  noiseFloorDb,
  isFrozen,
  isRtaFullscreen,
  toggleFreeze,
  toggleRtaFullscreen,
  onClearRTA,
  onClearGEQ,
  hasActiveRTAMarkers,
  hasActiveGEQBars,
  activeGeqCutCount,
  spectrumCanvasProps,
  geqBarViewProps,
}: DesktopGraphPanelsProps) {
  return (
    <ResizablePanel defaultSize={defaultSize}>
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel defaultSize="60%" minSize="20%" collapsible>
          <DesktopRtaPanel
            rtaContainerRef={rtaContainerRef}
            isRunning={isRunning}
            noiseFloorDb={noiseFloorDb}
            isFrozen={isFrozen}
            isRtaFullscreen={isRtaFullscreen}
            toggleFreeze={toggleFreeze}
            toggleRtaFullscreen={toggleRtaFullscreen}
            onClearRTA={onClearRTA}
            hasActiveRTAMarkers={hasActiveRTAMarkers}
            spectrumCanvasProps={spectrumCanvasProps}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="40%" minSize="15%" collapsible>
          <DesktopGeqPanel
            isRunning={isRunning}
            onClearGEQ={onClearGEQ}
            hasActiveGEQBars={hasActiveGEQBars}
            activeGeqCutCount={activeGeqCutCount}
            geqBarViewProps={geqBarViewProps}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </ResizablePanel>
  )
})
