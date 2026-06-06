'use client'

import { useRef, memo, useLayoutEffect } from 'react'
import { AnalyzerKeyboardShortcuts } from './AnalyzerKeyboardShortcuts'
import { AudioAnalyzerAlerts } from './AudioAnalyzerAlerts'
import { AudioAnalyzerFooter } from './AudioAnalyzerFooter'
import { HeaderBar } from './HeaderBar'
import { MobileLayout } from './MobileLayout'
import { DesktopLayout } from './DesktopLayout'
import { useAudioAnalyzerViewState } from '@/hooks/useAudioAnalyzerViewState'

import { AudioAnalyzerProvider } from '@/contexts/AudioAnalyzerContext'
import { AdvisoryProvider } from '@/contexts/AdvisoryContext'
import { UIProvider, useUI } from '@/contexts/UIContext'

export const AudioAnalyzer = memo(function AudioAnalyzerComponent() {
  const frozenRef = useRef(false)

  return (
    <div className="flex flex-col h-screen bg-background">
      <AudioAnalyzerProvider frozenRef={frozenRef}>
        <AudioAnalyzerInner
          frozenRef={frozenRef}
        />
      </AudioAnalyzerProvider>
    </div>
  )
})

function FrozenSync({ frozenRef }: { frozenRef: React.RefObject<boolean> }) {
  const { isFrozen } = useUI()
  useLayoutEffect(() => {
    frozenRef.current = isFrozen
  })
  return null
}

interface AudioAnalyzerInnerProps {
  frozenRef: React.RefObject<boolean>
}

const AudioAnalyzerInner = memo(function AudioAnalyzerInner({
  frozenRef,
}: AudioAnalyzerInnerProps) {
  const {
    error,
    workerError,
    isWorkerPermanentlyDead,
    actualFps,
    droppedPercent,
    shellState,
  } = useAudioAnalyzerViewState()

  return (
    <AdvisoryProvider>
      <UIProvider>
        <FrozenSync frozenRef={frozenRef} />
        <AnalyzerKeyboardShortcuts />
        <AudioAnalyzerAlerts
          error={error}
          workerError={workerError}
          isErrorDismissed={shellState.isErrorDismissed}
          isWorkerPermanentlyDead={isWorkerPermanentlyDead}
          onDismissError={() => shellState.setIsErrorDismissed(true)}
          onRetry={shellState.handleRetry}
        />

        <HeaderBar />
        <MobileLayout />

        <DesktopLayout
          issuesPanelOpen={shellState.issuesPanelOpen}
          issuesPanelRef={shellState.issuesPanelRef}
          activeSidebarTab={shellState.activeSidebarTab}
          setActiveSidebarTab={shellState.setActiveSidebarTab}
          openIssuesPanel={shellState.openIssuesPanel}
          closeIssuesPanel={shellState.closeIssuesPanel}
          closeIssuesPanelToIssues={shellState.closeIssuesPanelToIssues}
          setIssuesPanelOpen={shellState.setIssuesPanelOpen}
        />
        <AudioAnalyzerFooter actualFps={actualFps} droppedPercent={droppedPercent} />
      </UIProvider>
    </AdvisoryProvider>
  )
})
