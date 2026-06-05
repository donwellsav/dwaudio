'use client'

import { useCallback, useEffect } from 'react'
import { useCurrentRunRecurrence } from '@/hooks/useCurrentRunRecurrence'
import type { DSPWorkerHandle } from '@/hooks/useDSPWorker'
import {
  getFeedbackHotspotSummaries,
  getFeedbackHistory,
} from '@/lib/dsp/feedbackHistory'
import type { Advisory, DetectorSettings, SpectrumData } from '@/types/advisory'

interface UseAnalyzerSessionEffectsParams {
  dspWorker: Pick<DSPWorkerHandle, 'syncFeedbackHistory'>
  advisories: Advisory[]
  spectrumRef: React.RefObject<SpectrumData | null>
  settings: DetectorSettings
}

export function useAnalyzerSessionEffects({
  dspWorker,
  advisories,
  spectrumRef,
  settings,
}: UseAnalyzerSessionEffectsParams): void {
  const syncFeedbackHistory = useCallback(() => {
    dspWorker.syncFeedbackHistory(getFeedbackHotspotSummaries())
  }, [dspWorker])

  useEffect(() => {
    getFeedbackHistory().setMode(settings.mode)
    syncFeedbackHistory()
  }, [settings.mode, syncFeedbackHistory])

  useCurrentRunRecurrence(advisories, syncFeedbackHistory)
  void spectrumRef
}
