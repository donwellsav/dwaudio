/**
 * Current-run feedback memory.
 *
 * This is intentionally in-memory only. It groups feedback advisories during
 * the active analyzer run so the UI and worker can recognize repeat
 * frequencies. It does not write to IndexedDB, localStorage, a backend, or an
 * export file, and it does not keep training labels or applied-cut history.
 */

import { HOTSPOT_COOLDOWN_BY_MODE, HOTSPOT_COOLDOWN_MS } from '@/lib/dsp/constants'
import {
  FEEDBACK_HISTORY_GROUPING_CENTS,
  isWithinFeedbackHistoryTolerance,
  type FeedbackHotspotSummary,
} from '@/lib/dsp/feedbackHistoryShared'
import { hzToCents } from '@/lib/utils/pitchUtils'

export interface FeedbackEvent {
  timestamp: number
  frequencyHz: number
  amplitudeDb: number
  prominenceDb: number
  severity: string
  confidence: number
  modalOverlapFactor?: number
  cumulativeGrowthDb?: number
  frequencyBand?: 'LOW' | 'MID' | 'HIGH'
  label: string
}

export interface FrequencyHotspot {
  centerFrequencyHz: number
  occurrences: number
  events: FeedbackEvent[]
  firstSeen: number
  lastSeen: number
  maxAmplitudeDb: number
  avgAmplitudeDb: number
  avgConfidence: number
  suggestedCutDb: number
  isRepeatOffender: boolean
  lastEventTime: number
}

const REPEAT_OFFENDER_THRESHOLD = 3
const MAX_EVENTS_PER_HOTSPOT = 50

export class FeedbackHistory {
  private hotspots: Map<string, FrequencyHotspot> = new Map()
  private hotspotBucketIndex: Map<number, Set<string>> = new Map()
  private mode = 'speech'

  setMode(mode: string): void {
    this.mode = mode
  }

  getMode(): string {
    return this.mode
  }

  getEffectiveCooldown(): number {
    return HOTSPOT_COOLDOWN_BY_MODE[this.mode] ?? HOTSPOT_COOLDOWN_MS
  }

  recordEvent(event: FeedbackEvent): FeedbackEvent {
    this.updateHotspot(event)
    return event
  }

  getHotspots(): FrequencyHotspot[] {
    return Array.from(this.hotspots.values())
      .sort((left, right) => right.occurrences - left.occurrences)
  }

  getHotspotSummaries(): FeedbackHotspotSummary[] {
    return this.getHotspots().map((hotspot) => ({
      centerFrequencyHz: hotspot.centerFrequencyHz,
      occurrences: hotspot.occurrences,
      lastSeen: hotspot.lastSeen,
    }))
  }

  getRepeatOffenders(): FrequencyHotspot[] {
    return this.getHotspots().filter((hotspot) => hotspot.isRepeatOffender)
  }

  isRepeatOffender(frequencyHz: number): boolean {
    return this.findHotspotForFrequency(frequencyHz)?.isRepeatOffender ?? false
  }

  getOccurrenceCount(frequencyHz: number): number {
    return this.findHotspotForFrequency(frequencyHz)?.occurrences ?? 0
  }

  getOccurrenceCounts(frequenciesHz: readonly number[]): Map<number, number> {
    const counts = new Map<number, number>()
    for (const frequencyHz of frequenciesHz) {
      counts.set(frequencyHz, this.getOccurrenceCount(frequencyHz))
    }
    return counts
  }

  clear(): void {
    this.hotspots.clear()
    this.hotspotBucketIndex.clear()
  }

  private getFrequencyBucket(frequencyHz: number): number {
    return Math.floor((1200 * Math.log2(frequencyHz)) / FEEDBACK_HISTORY_GROUPING_CENTS)
  }

  private addHotspotToIndex(hotspotKey: string, centerFrequencyHz: number): void {
    const bucket = this.getFrequencyBucket(centerFrequencyHz)
    const entries = this.hotspotBucketIndex.get(bucket)
    if (entries) {
      entries.add(hotspotKey)
    } else {
      this.hotspotBucketIndex.set(bucket, new Set([hotspotKey]))
    }
  }

  private removeHotspotFromIndex(hotspotKey: string, centerFrequencyHz: number): void {
    const bucket = this.getFrequencyBucket(centerFrequencyHz)
    const entries = this.hotspotBucketIndex.get(bucket)
    if (!entries) return
    entries.delete(hotspotKey)
    if (entries.size === 0) {
      this.hotspotBucketIndex.delete(bucket)
    }
  }

  private updateHotspotIndex(hotspotKey: string, previousCenterHz: number, nextCenterHz: number): void {
    const previousBucket = this.getFrequencyBucket(previousCenterHz)
    const nextBucket = this.getFrequencyBucket(nextCenterHz)
    if (previousBucket === nextBucket) return
    this.removeHotspotFromIndex(hotspotKey, previousCenterHz)
    this.addHotspotToIndex(hotspotKey, nextCenterHz)
  }

  private findHotspotForFrequency(frequencyHz: number): FrequencyHotspot | undefined {
    const key = this.findHotspotKey(frequencyHz)
    return key ? this.hotspots.get(key) : undefined
  }

  private findHotspotKey(frequencyHz: number): string | undefined {
    const bucket = this.getFrequencyBucket(frequencyHz)
    let bestMatch: { key: string; cents: number } | null = null

    for (const candidateBucket of [bucket - 1, bucket, bucket + 1]) {
      const candidateKeys = this.hotspotBucketIndex.get(candidateBucket)
      if (!candidateKeys) continue

      for (const key of candidateKeys) {
        const hotspot = this.hotspots.get(key)
        if (!hotspot) continue
        if (!isWithinFeedbackHistoryTolerance(frequencyHz, hotspot.centerFrequencyHz)) continue

        const cents = Math.abs(hzToCents(frequencyHz, hotspot.centerFrequencyHz))
        if (!bestMatch || cents < bestMatch.cents) {
          bestMatch = { key, cents }
        }
      }
    }

    return bestMatch?.key
  }

  private updateHotspot(event: FeedbackEvent): void {
    let hotspotKey = this.findHotspotKey(event.frequencyHz)
    let hotspot = hotspotKey ? this.hotspots.get(hotspotKey) : undefined

    if (!hotspot) {
      hotspot = {
        centerFrequencyHz: event.frequencyHz,
        occurrences: 0,
        events: [],
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        maxAmplitudeDb: event.amplitudeDb,
        avgAmplitudeDb: event.amplitudeDb,
        avgConfidence: event.confidence,
        suggestedCutDb: Math.min(event.prominenceDb * 1.5, 12),
        isRepeatOffender: false,
        lastEventTime: 0,
      }
      hotspotKey = `hs_${event.timestamp}_${Math.round(event.frequencyHz)}`
      this.hotspots.set(hotspotKey, hotspot)
      this.addHotspotToIndex(hotspotKey, hotspot.centerFrequencyHz)
    }

    if (!hotspotKey) return

    if (hotspot.lastEventTime > 0) {
      if (event.timestamp - hotspot.lastEventTime < this.getEffectiveCooldown()) {
        return
      }
    }

    const previousCenterHz = hotspot.centerFrequencyHz
    hotspot.occurrences++
    hotspot.lastEventTime = event.timestamp
    hotspot.events.push(event)
    if (hotspot.events.length > MAX_EVENTS_PER_HOTSPOT) {
      hotspot.events = hotspot.events.slice(-MAX_EVENTS_PER_HOTSPOT)
    }
    hotspot.lastSeen = event.timestamp
    hotspot.maxAmplitudeDb = Math.max(hotspot.maxAmplitudeDb, event.amplitudeDb)
    hotspot.isRepeatOffender = hotspot.occurrences >= REPEAT_OFFENDER_THRESHOLD
    this.recomputeHotspotStats(hotspot)
    this.updateHotspotIndex(hotspotKey, previousCenterHz, hotspot.centerFrequencyHz)
  }

  private recomputeHotspotStats(hotspot: FrequencyHotspot): void {
    let amplitudeSum = 0
    let confidenceSum = 0
    let frequencySum = 0
    let maxProminence = 0

    for (const event of hotspot.events) {
      amplitudeSum += event.amplitudeDb
      confidenceSum += event.confidence
      frequencySum += event.frequencyHz
      maxProminence = Math.max(maxProminence, event.prominenceDb)
    }

    const count = hotspot.events.length
    if (count === 0) return

    hotspot.avgAmplitudeDb = amplitudeSum / count
    hotspot.avgConfidence = confidenceSum / count
    hotspot.centerFrequencyHz = frequencySum / count
    hotspot.suggestedCutDb = Math.min(maxProminence * 1.5 + (hotspot.occurrences - 1) * 0.5, 12)
  }
}

let instance: FeedbackHistory | null = null

export function getFeedbackHistory(): FeedbackHistory {
  if (!instance) {
    instance = new FeedbackHistory()
  }
  return instance
}

export function resetFeedbackHistoryForCurrentRun(): void {
  getFeedbackHistory().clear()
}

export function getFeedbackHotspotSummaries(): FeedbackHotspotSummary[] {
  return getFeedbackHistory().getHotspotSummaries()
}

export function recordFeedbackFromAdvisory(advisory: {
  trueFrequencyHz: number
  trueAmplitudeDb: number
  prominenceDb: number
  severity: string
  confidence: number
  modalOverlapFactor?: number
  cumulativeGrowthDb?: number
  frequencyBand?: 'LOW' | 'MID' | 'HIGH'
  label: string
}): FeedbackEvent {
  return getFeedbackHistory().recordEvent({
    timestamp: Date.now(),
    frequencyHz: advisory.trueFrequencyHz,
    amplitudeDb: advisory.trueAmplitudeDb,
    prominenceDb: advisory.prominenceDb,
    severity: advisory.severity,
    confidence: advisory.confidence,
    modalOverlapFactor: advisory.modalOverlapFactor,
    cumulativeGrowthDb: advisory.cumulativeGrowthDb,
    frequencyBand: advisory.frequencyBand,
    label: advisory.label,
  })
}
