import { hzToCents } from '@/lib/utils/pitchUtils'

export const FEEDBACK_HISTORY_GROUPING_CENTS = 100

export interface FeedbackHotspotSummary {
  centerFrequencyHz: number
  occurrences: number
  lastSeen: number
}

export function isWithinFeedbackHistoryTolerance(
  frequencyHz: number,
  centerFrequencyHz: number,
): boolean {
  return (
    Math.abs(hzToCents(frequencyHz, centerFrequencyHz)) <=
    FEEDBACK_HISTORY_GROUPING_CENTS
  )
}
