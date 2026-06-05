import { useEffect, useRef } from 'react'
import { recordFeedbackFromAdvisory } from '@/lib/dsp/feedbackHistory'
import type { Advisory } from '@/types/advisory'

/**
 * Updates in-memory recurrence state for the current analyzer run only.
 * No data is persisted or sent anywhere.
 */
export function useCurrentRunRecurrence(
  advisories: Advisory[],
  onRecorded?: () => void,
) {
  const recordedIdsRef = useRef(new Set<string>())

  useEffect(() => {
    let recorded = false

    advisories.forEach((advisory) => {
      if (recordedIdsRef.current.has(advisory.id)) return
      if (
        advisory.confidence >= 0.6 &&
        (advisory.label === 'ACOUSTIC_FEEDBACK' || advisory.label === 'POSSIBLE_RING')
      ) {
        recordFeedbackFromAdvisory(advisory)
        recordedIdsRef.current.add(advisory.id)
        recorded = true
      }
    })

    const currentIds = new Set(advisories.map((advisory) => advisory.id))
    recordedIdsRef.current.forEach((id) => {
      if (!currentIds.has(id)) {
        recordedIdsRef.current.delete(id)
      }
    })

    if (recorded) {
      onRecorded?.()
    }
  }, [advisories, onRecorded])
}
