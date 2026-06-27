'use client'

import { useCallback, useEffect, useRef, memo, useLayoutEffect } from 'react'
import { AnalyzerKeyboardShortcuts } from './AnalyzerKeyboardShortcuts'
import { AudioAnalyzerAlerts } from './AudioAnalyzerAlerts'
import { AudioAnalyzerFooter } from './AudioAnalyzerFooter'
import { HeaderBar } from './HeaderBar'
import { MobileLayout } from './MobileLayout'
import { DesktopLayout } from './DesktopLayout'

import { AudioAnalyzerProvider } from '@/contexts/AudioAnalyzerContext'
import { AdvisoryProvider } from '@/contexts/AdvisoryContext'
import { UIProvider, useUI } from '@/contexts/UIContext'
import { useDetection } from '@/contexts/DetectionContext'
import { useEngine } from '@/contexts/EngineContext'
import { useMetering } from '@/contexts/MeteringContext'
import { useSettings } from '@/contexts/SettingsContext'
import { useAnalyzerShellState } from '@/hooks/useAnalyzerShellState'
import { useCurrentRunRecurrence } from '@/hooks/useCurrentRunRecurrence'
import { useFpsMonitor } from '@/hooks/useFpsMonitor'
import {
  getFeedbackHotspotSummaries,
  getFeedbackHistory,
} from '@/lib/dsp/feedbackHistory'

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
  const { isRunning, error, workerError, start, dspWorker } = useEngine()
  const { settings } = useSettings()
  const { spectrumRef } = useMetering()
  const { advisories } = useDetection()
  const { actualFps, droppedPercent } = useFpsMonitor(isRunning, settings.canvasTargetFps)
  const shellState = useAnalyzerShellState(error, start)
  const syncFeedbackHistory = useCallback(() => {
    dspWorker.syncFeedbackHistory(getFeedbackHotspotSummaries())
  }, [dspWorker])

  useEffect(() => {
    getFeedbackHistory().setMode(settings.mode)
    syncFeedbackHistory()
  }, [settings.mode, syncFeedbackHistory])

  useCurrentRunRecurrence(advisories, syncFeedbackHistory)
  void spectrumRef

  return (
    <AdvisoryProvider>
      <UIProvider>
        <FrozenSync frozenRef={frozenRef} />
        <AnalyzerKeyboardShortcuts />
        <AudioAnalyzerAlerts
          error={error}
          workerError={workerError}
          isErrorDismissed={shellState.isErrorDismissed}
          isWorkerPermanentlyDead={dspWorker.isPermanentlyDead}
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
