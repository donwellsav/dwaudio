import { useCallback } from 'react'
import { MODE_BASELINES } from '@/lib/settings/modeBaselines'
import type { DwaSessionState } from '@/types/settings'

/**
 * Converts an absolute dB threshold (from RTA drag or fader) into a
 * sensitivity offset delta and applies it via setSensitivityOffset.
 *
 * Extracted from DesktopLayout/MobileLayout to eliminate duplication.
 */
export function useThresholdChange(
  session: DwaSessionState,
  setSensitivityOffset: (offset: number) => void,
) {
  return useCallback((db: number) => {
    const bl = MODE_BASELINES[session.modeId]
    const ce = bl.feedbackThresholdDb + session.liveOverrides.sensitivityOffsetDb
    const d = db - ce
    if (d !== 0) setSensitivityOffset(session.liveOverrides.sensitivityOffsetDb + d)
  }, [session.modeId, session.liveOverrides.sensitivityOffsetDb, setSensitivityOffset])
}
