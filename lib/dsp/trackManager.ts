// DoneWell Audio Track Manager - Associates peaks to tracks and extracts features

import { TRACK_SETTINGS } from './constants'
import { hzToCents } from '@/lib/utils/pitchUtils'
import { generateId } from '@/lib/utils/mathHelpers'
import type {
  DetectedPeak,
  Severity,
  Track,
  TrackFeatures,
  TrackHistoryEntry,
  TrackSummary,
  TrackedPeak,
} from '@/types/advisory'

// Maximum number of confirmed partials used to normalise the harmonicity score (0..1)
const MAX_HARMONICS_FOR_SCORE = 4

// Cents tolerance when matching other tracks' harmonicOfHz to this track's frequency.
// Tighter than ASSOCIATION_TOLERANCE_CENTS because harmonic-root matching needs precision.
const HARMONIC_ROOT_TOLERANCE_CENTS = 20

// Minimum delta-time (seconds) for velocity calculation to avoid division by near-zero
const MIN_VELOCITY_DT_SEC = 0.05

const VELOCITY_WINDOW_MS = 500
const MIN_MODULATION_SAMPLES = 20
const MAX_MODULATION_SAMPLES = 48
const ARRAY_INDEX_PATTERN = /^(0|[1-9]\d*)$/

function resolveOnsetTime(peak: DetectedPeak): number {
  return typeof peak.firstSeenAt === 'number'
    && Number.isFinite(peak.firstSeenAt)
    && peak.firstSeenAt <= peak.timestamp
    ? peak.firstSeenAt
    : peak.timestamp
}

/** Snapshot of an evicted track for fast restoration */
interface EvictedTrackSnapshot {
  frequencyHz: number
  cumulativeGrowthDb: number
  peakAmplitudeDb: number
  evictedAt: number
}

interface TrackHistoryState {
  buffer: TrackHistoryEntry[]
  start: number
  count: number
  capacity: number
  sumFreqHz: number
  sumQ: number
  minQ: number
  minQDirty: boolean
  velocityWindowStart: number
}

const EVICTION_CACHE_SIZE = 16
const EVICTION_CACHE_TTL_MS = 5000

function parseArrayIndex(prop: PropertyKey): number | null {
  if (typeof prop !== 'string' || !ARRAY_INDEX_PATTERN.test(prop)) return null
  return Number(prop)
}

function getHistoryEntry(state: TrackHistoryState, index: number): TrackHistoryEntry {
  return state.buffer[(state.start + index) % state.capacity]
}

function createHistoryProxy(state: TrackHistoryState): TrackHistoryEntry[] {
  const target: TrackHistoryEntry[] = []

  return new Proxy(target, {
    get(innerTarget, prop, receiver) {
      if (prop === 'length') return state.count
      if (prop === Symbol.iterator) {
        return function* historyIterator(): IterableIterator<TrackHistoryEntry> {
          for (let i = 0; i < state.count; i++) {
            yield getHistoryEntry(state, i)
          }
        }
      }

      const index = parseArrayIndex(prop)
      if (index !== null) {
        return index >= 0 && index < state.count ? getHistoryEntry(state, index) : undefined
      }

      return Reflect.get(innerTarget, prop, receiver)
    },
    has(innerTarget, prop) {
      const index = parseArrayIndex(prop)
      if (index !== null) return index >= 0 && index < state.count
      if (prop === 'length') return true
      return Reflect.has(innerTarget, prop)
    },
    ownKeys(innerTarget) {
      const keys = Reflect.ownKeys(innerTarget).filter((key) => key !== 'length')
      for (let i = 0; i < state.count; i++) {
        keys.push(String(i))
      }
      keys.push('length')
      return keys
    },
    getOwnPropertyDescriptor(innerTarget, prop) {
      if (prop === 'length') {
        return {
          configurable: false,
          enumerable: false,
          value: state.count,
          writable: false,
        }
      }

      const index = parseArrayIndex(prop)
      if (index !== null && index >= 0 && index < state.count) {
        return {
          configurable: true,
          enumerable: true,
          value: getHistoryEntry(state, index),
          writable: false,
        }
      }

      return Reflect.getOwnPropertyDescriptor(innerTarget, prop)
    },
  })
}

function createTrackSummaryShell(): TrackSummary {
  return {
    id: '',
    frequency: 0,
    amplitude: 0,
    prominenceDb: 0,
    qEstimate: 0,
    bandwidthHz: 0,
    qMeasurementMode: undefined,
    classification: 'unknown',
    severity: 'unknown',
    onsetTime: 0,
    onsetAmplitudeDb: 0,
    lastUpdateTime: 0,
    active: false,
    features: {
      stabilityCentsStd: 0,
      harmonicityScore: 0,
      modulationScore: 0,
      velocityDbPerSec: 0,
    },
    msd: undefined,
    msdIsHowl: undefined,
    persistenceFrames: undefined,
  }
}

export class TrackManager {
  private tracks: Map<string, Track> = new Map()
  private binToTrackId: Map<number, string> = new Map()
  private maxTracks: number
  private historySize: number
  private associationToleranceCents: number
  private trackTimeoutMs: number
  private _activeTracksCache: Track[] = []
  private _activeTrackIndex: Map<string, number> = new Map()
  /** Reusable objects for getActiveTrackSummaries() */
  private _activePeaksPool: TrackSummary[] = []
  /** Recently evicted tracks — restore history on re-detection instead of starting cold */
  private _evictedCache: EvictedTrackSnapshot[] = []
  /** Per-track circular history state */
  private _historyStates: WeakMap<Track, TrackHistoryState> = new WeakMap()
  /** Reusable scratch buffer for modulation autocorrelation */
  private _deviationScratch: Float64Array

  constructor(options: Partial<{
    maxTracks: number
    historySize: number
    associationToleranceCents: number
    trackTimeoutMs: number
  }> = {}) {
    this.maxTracks = options.maxTracks ?? TRACK_SETTINGS.MAX_TRACKS
    this.historySize = options.historySize ?? TRACK_SETTINGS.HISTORY_SIZE
    this.associationToleranceCents = options.associationToleranceCents ?? TRACK_SETTINGS.ASSOCIATION_TOLERANCE_CENTS
    this.trackTimeoutMs = options.trackTimeoutMs ?? TRACK_SETTINGS.TRACK_TIMEOUT_MS
    this._deviationScratch = new Float64Array(this.historySize)
  }

  /**
   * Update runtime-configurable options without clearing tracks
   */
  updateOptions(options: Partial<{ maxTracks: number; trackTimeoutMs: number }>) {
    if (options.maxTracks !== undefined) this.maxTracks = options.maxTracks
    if (options.trackTimeoutMs !== undefined) this.trackTimeoutMs = options.trackTimeoutMs
  }

  /**
   * Process a detected peak and associate/create a track
   */
  processPeak(peak: DetectedPeak & { qEstimate?: number; bandwidthHz?: number; msd?: number; msdGrowthRate?: number; msdIsHowl?: boolean; msdFastConfirm?: boolean }): Track {
    const existingTrackId = this.binToTrackId.get(peak.binIndex)

    if (existingTrackId) {
      const track = this.tracks.get(existingTrackId)
      if (track) {
        return this.updateTrack(track, peak)
      }
    }

    const nearestTrack = this.findNearestTrack(peak.trueFrequencyHz)
    if (nearestTrack) {
      const cents = Math.abs(hzToCents(peak.trueFrequencyHz, nearestTrack.trueFrequencyHz))
      if (cents <= this.associationToleranceCents) {
        this.binToTrackId.delete(nearestTrack.binIndex)
        this.binToTrackId.set(peak.binIndex, nearestTrack.id)
        nearestTrack.binIndex = peak.binIndex
        return this.updateTrack(nearestTrack, peak)
      }
    }

    return this.createTrack(peak)
  }

  /**
   * Mark a track as cleared (peak no longer detected)
   */
  clearTrack(binIndex: number, timestamp: number): number | null {
    const trackId = this.binToTrackId.get(binIndex)
    if (!trackId) return null

    const track = this.tracks.get(trackId)
    if (track) {
      const lastAmplitude = track.trueAmplitudeDb
      if (track.isActive) {
        track.isActive = false
        this._removeActiveTrack(track.id)
      }
      track.lastUpdateTime = timestamp
      return lastAmplitude
    }
    return null
  }

  /**
   * Legacy detailed active-track snapshots with history.
   * Avoid using this on the worker hot path.
   */
  getActiveTracks(): TrackedPeak[] {
    const cache = this._activeTracksCache
    const result: TrackedPeak[] = new Array(cache.length)
    for (let i = 0; i < cache.length; i++) {
      result[i] = this.trackToTrackedPeak(cache[i])
    }
    return result
  }

  /**
   * Compact active-track snapshots for worker -> UI transport.
   */
  getActiveTrackSummaries(): TrackSummary[] {
    const cache = this._activeTracksCache
    const result: TrackSummary[] = new Array(cache.length)

    for (let i = 0; i < cache.length; i++) {
      let pooled = this._activePeaksPool[i]
      if (!pooled) {
        pooled = createTrackSummaryShell()
        this._activePeaksPool[i] = pooled
      }
      result[i] = this.trackToTrackSummary(cache[i], pooled)
    }

    return result
  }

  /**
   * Check if a track ID is currently active. O(1) Map lookup.
   * Used by combTracker prune to avoid allocating a Set of active IDs.
   */
  isActiveTrack(id: string): boolean {
    return this._activeTrackIndex.has(id)
  }

  /**
   * Get raw Track objects (for internal use)
   */
  getRawTracks(): Track[] {
    return this._activeTracksCache
  }

  /**
   * Get all tracks (including inactive)
   */
  getAllTracks(): Track[] {
    return Array.from(this.tracks.values())
  }

  /**
   * Get track by ID
   */
  getTrack(id: string): Track | undefined {
    return this.tracks.get(id)
  }

  /**
   * Prune old inactive tracks
   */
  pruneInactiveTracks(currentTime: number): void {
    const toDelete: string[] = []

    for (const [id, track] of this.tracks) {
      if (!track.isActive && currentTime - track.lastUpdateTime > this.trackTimeoutMs) {
        toDelete.push(id)
        this.binToTrackId.delete(track.binIndex)
      }
    }

    for (const id of toDelete) {
      const evicted = this.tracks.get(id)
      if (evicted && evicted.trueFrequencyHz > 0) {
        this._evictedCache.push({
          frequencyHz: evicted.trueFrequencyHz,
          cumulativeGrowthDb: evicted.trueAmplitudeDb - evicted.onsetDb,
          peakAmplitudeDb: evicted.trueAmplitudeDb,
          evictedAt: currentTime,
        })
        if (this._evictedCache.length > EVICTION_CACHE_SIZE) this._evictedCache.shift()
      }
      this.tracks.delete(id)
    }

    this._evictedCache = this._evictedCache.filter((entry) => currentTime - entry.evictedAt < EVICTION_CACHE_TTL_MS)

    if (this.tracks.size > this.maxTracks) {
      const sorted = Array.from(this.tracks.values())
        .sort((a, b) => {
          const scoreA = this._evictionScore(a, currentTime)
          const scoreB = this._evictionScore(b, currentTime)
          return scoreB - scoreA
        })

      const toRemove = sorted.slice(0, this.tracks.size - this.maxTracks)
      for (const track of toRemove) {
        this.tracks.delete(track.id)
        this.binToTrackId.delete(track.binIndex)
        if (track.isActive) {
          this._removeActiveTrack(track.id)
        }
      }
    }
  }

  /**
   * Clear all tracks
   */
  clear(): void {
    this.tracks.clear()
    this.binToTrackId.clear()
    this._activeTracksCache = []
    this._activeTrackIndex.clear()
    this._activePeaksPool = []
    this._historyStates = new WeakMap()
  }

  private _evictionScore(track: Track, now: number): number {
    const staleness = (now - track.lastUpdateTime) / this.trackTimeoutMs

    const normProminence = Math.min(Math.max(track.prominenceDb / 30, 0), 1)
    const normQ = Math.min(track.qEstimate, 50) / 50
    const normStability = 1 - Math.min(track.features.stabilityCentsStd, 100) / 100
    const clarity = (normProminence + normQ + normStability) / 3

    return staleness - clarity * 0.5
  }

  private _addActiveTrack(track: Track): void {
    if (this._activeTrackIndex.has(track.id)) return
    this._activeTrackIndex.set(track.id, this._activeTracksCache.length)
    this._activeTracksCache.push(track)
  }

  private _removeActiveTrack(trackId: string): void {
    const index = this._activeTrackIndex.get(trackId)
    if (index === undefined) return

    const lastIndex = this._activeTracksCache.length - 1
    const lastTrack = this._activeTracksCache[lastIndex]

    if (index !== lastIndex) {
      this._activeTracksCache[index] = lastTrack
      this._activeTrackIndex.set(lastTrack.id, index)
    }

    this._activeTracksCache.pop()
    this._activeTrackIndex.delete(trackId)
  }

  private getHistoryState(track: Track): TrackHistoryState {
    const state = this._historyStates.get(track)
    if (!state) {
      throw new Error(`Missing history state for track ${track.id}`)
    }
    return state
  }

  private appendHistory(track: Track, entry: TrackHistoryEntry): TrackHistoryState {
    const state = this.getHistoryState(track)
    const writeIndex = (state.start + state.count) % state.capacity

    if (state.count < state.capacity) {
      state.buffer[writeIndex] = entry
      state.count++
    } else {
      const evicted = state.buffer[state.start]
      state.sumFreqHz -= evicted.freqHz
      state.sumQ -= evicted.qEstimate
      if (evicted.qEstimate <= state.minQ) {
        state.minQDirty = true
      }
      state.buffer[state.start] = entry
      state.start = (state.start + 1) % state.capacity
      if (state.velocityWindowStart > 0) {
        state.velocityWindowStart--
      }
    }

    state.sumFreqHz += entry.freqHz
    state.sumQ += entry.qEstimate
    if (entry.qEstimate <= state.minQ) {
      state.minQ = entry.qEstimate
      state.minQDirty = false
    }

    const newest = getHistoryEntry(state, state.count - 1)
    while (
      state.velocityWindowStart < state.count - 1
      && newest.time - getHistoryEntry(state, state.velocityWindowStart).time > VELOCITY_WINDOW_MS
    ) {
      state.velocityWindowStart++
    }

    return state
  }

  private createTrack(peak: DetectedPeak & { qEstimate?: number; bandwidthHz?: number; msd?: number; msdGrowthRate?: number; msdIsHowl?: boolean; msdFastConfirm?: boolean; persistenceFrames?: number; persistenceBoost?: number; isPersistent?: boolean; isHighlyPersistent?: boolean }): Track {
    const id = generateId()
    const qEstimate = peak.qEstimate ?? 10
    const bandwidthHz = peak.bandwidthHz ?? 100
    const onsetTime = resolveOnsetTime(peak)
    const initialPersistenceMs = Math.max(0, peak.timestamp - onsetTime, peak.sustainedMs ?? 0)
    const historyEntry: TrackHistoryEntry = {
      time: peak.timestamp,
      freqHz: peak.trueFrequencyHz,
      ampDb: peak.trueAmplitudeDb,
      prominenceDb: peak.prominenceDb,
      qEstimate,
    }

    const historyState: TrackHistoryState = {
      buffer: new Array<TrackHistoryEntry>(this.historySize),
      start: 0,
      count: 1,
      capacity: this.historySize,
      sumFreqHz: historyEntry.freqHz,
      sumQ: historyEntry.qEstimate,
      minQ: historyEntry.qEstimate,
      minQDirty: false,
      velocityWindowStart: 0,
    }
    historyState.buffer[0] = historyEntry

    const track: Track = {
      id,
      binIndex: peak.binIndex,
      trueFrequencyHz: peak.trueFrequencyHz,
      trueAmplitudeDb: peak.trueAmplitudeDb,
      prominenceDb: peak.prominenceDb,
      onsetTime,
      onsetDb: peak.trueAmplitudeDb,
      lastUpdateTime: peak.timestamp,
      history: createHistoryProxy(historyState),
      features: this.initializeFeatures({
        meanQ: qEstimate,
        minQ: qEstimate,
        persistenceMs: initialPersistenceMs,
      }),
      qEstimate,
      bandwidthHz,
      qMeasurementMode: peak.qMeasurementMode,
      phpr: peak.phpr,
      firstSeenAt: peak.firstSeenAt,
      confirmedAt: peak.confirmedAt,
      confirmLatencyMs: peak.confirmLatencyMs,
      velocityDbPerSec: 0,
      harmonicOfHz: peak.harmonicOfHz,
      isSubHarmonicRoot: peak.isSubHarmonicRoot ?? false,
      isActive: true,
      msd: peak.msd,
      msdGrowthRate: peak.msdGrowthRate,
      msdIsHowl: peak.msdIsHowl,
      msdFastConfirm: peak.msdFastConfirm,
      persistenceFrames: peak.persistenceFrames,
      persistenceBoost: peak.persistenceBoost,
      isPersistent: peak.isPersistent,
      isHighlyPersistent: peak.isHighlyPersistent,
    }

    this._historyStates.set(track, historyState)

    const evictedIdx = this._evictedCache.findIndex((entry) =>
      Math.abs(1200 * Math.log2(peak.trueFrequencyHz / entry.frequencyHz)) < 50
    )
    if (evictedIdx !== -1) {
      const restored = this._evictedCache[evictedIdx]
      track.onsetDb = track.trueAmplitudeDb - restored.cumulativeGrowthDb
      this._evictedCache.splice(evictedIdx, 1)
    }

    this.tracks.set(id, track)
    this.binToTrackId.set(peak.binIndex, id)
    this._addActiveTrack(track)
    return track
  }

  private updateTrack(track: Track, peak: DetectedPeak & { qEstimate?: number; bandwidthHz?: number; msd?: number; msdGrowthRate?: number; msdIsHowl?: boolean; msdFastConfirm?: boolean; persistenceFrames?: number; persistenceBoost?: number; isPersistent?: boolean; isHighlyPersistent?: boolean }): Track {
    const qEstimate = peak.qEstimate ?? track.qEstimate
    const bandwidthHz = peak.bandwidthHz ?? track.bandwidthHz
    const wasActive = track.isActive

    const entry: TrackHistoryEntry = {
      time: peak.timestamp,
      freqHz: peak.trueFrequencyHz,
      ampDb: peak.trueAmplitudeDb,
      prominenceDb: peak.prominenceDb,
      qEstimate,
    }

    this.appendHistory(track, entry)

    track.trueFrequencyHz = peak.trueFrequencyHz
    track.trueAmplitudeDb = peak.trueAmplitudeDb
    track.prominenceDb = peak.prominenceDb
    track.lastUpdateTime = peak.timestamp
    track.qEstimate = qEstimate
    track.bandwidthHz = bandwidthHz
    track.qMeasurementMode = peak.qMeasurementMode ?? track.qMeasurementMode
    track.phpr = peak.phpr ?? track.phpr
    track.firstSeenAt = peak.firstSeenAt ?? track.firstSeenAt
    track.confirmedAt = peak.confirmedAt ?? track.confirmedAt
    track.confirmLatencyMs = peak.confirmLatencyMs ?? track.confirmLatencyMs
    track.harmonicOfHz = peak.harmonicOfHz
    if (peak.isSubHarmonicRoot) track.isSubHarmonicRoot = true
    track.isActive = true

    track.msd = peak.msd
    track.msdGrowthRate = peak.msdGrowthRate
    track.msdIsHowl = peak.msdIsHowl
    track.msdFastConfirm = peak.msdFastConfirm

    track.persistenceFrames = peak.persistenceFrames
    track.persistenceBoost = peak.persistenceBoost
    track.isPersistent = peak.isPersistent
    track.isHighlyPersistent = peak.isHighlyPersistent

    const historyState = this.getHistoryState(track)
    const newest = getHistoryEntry(historyState, historyState.count - 1)
    const oldest = getHistoryEntry(historyState, historyState.velocityWindowStart)
    const dtSec = Math.max((newest.time - oldest.time) / 1000, MIN_VELOCITY_DT_SEC)
    if (dtSec > MIN_VELOCITY_DT_SEC) {
      track.velocityDbPerSec = (newest.ampDb - oldest.ampDb) / dtSec
    }

    track.features = this.extractFeatures(track, historyState)

    if (!wasActive) {
      this._addActiveTrack(track)
    }

    return track
  }

  private initializeFeatures(overrides: Partial<TrackFeatures> = {}): TrackFeatures {
    return {
      stabilityCentsStd: 0,
      meanQ: 10,
      minQ: 10,
      meanVelocityDbPerSec: 0,
      maxVelocityDbPerSec: 0,
      persistenceMs: 0,
      harmonicityScore: 0,
      modulationScore: 0,
      noiseSidebandScore: 0,
      ...overrides,
    }
  }

  private extractFeatures(track: Track, historyState: TrackHistoryState): TrackFeatures {
    const count = historyState.count
    if (count < 2) {
      return this.initializeFeatures({
        meanQ: track.qEstimate,
        minQ: track.qEstimate,
        persistenceMs: Math.max(0, track.lastUpdateTime - track.onsetTime),
      })
    }

    let sumVelocity = 0
    let velocityCount = 0
    let maxPositiveVelocity = 0

    let previous = getHistoryEntry(historyState, 0)
    for (let i = 1; i < count; i++) {
      const current = getHistoryEntry(historyState, i)

      const dt = (current.time - previous.time) / 1000
      if (dt > 0.01) {
        const velocity = (current.ampDb - previous.ampDb) / dt
        sumVelocity += velocity
        velocityCount++
        if (velocity > maxPositiveVelocity) maxPositiveVelocity = velocity
      }

      previous = current
    }

    const meanFreq = historyState.sumFreqHz / count
    let centsMean = 0
    let centsM2 = 0

    for (let i = 0; i < count; i++) {
      const cents = hzToCents(getHistoryEntry(historyState, i).freqHz, meanFreq)
      const sampleCount = i + 1
      const delta = cents - centsMean
      centsMean += delta / sampleCount
      const delta2 = cents - centsMean
      centsM2 += delta * delta2
    }

    const persistenceMs = track.lastUpdateTime - track.onsetTime
    const harmonicityScore = this.computeHarmonicityScore(track)
    const modulationScore = this.computeModulationScore(historyState)
    const minQ = this.resolveMinQ(historyState)

    return {
      stabilityCentsStd: Math.sqrt(centsM2 / (count - 1)),
      meanQ: historyState.sumQ / count,
      minQ,
      meanVelocityDbPerSec: velocityCount > 0 ? sumVelocity / velocityCount : 0,
      maxVelocityDbPerSec: maxPositiveVelocity,
      persistenceMs,
      harmonicityScore,
      modulationScore,
      noiseSidebandScore: 0,
    }
  }

  private computeHarmonicityScore(track: Track): number {
    if (track.harmonicOfHz !== null) {
      return 0.8
    }

    if (track.isSubHarmonicRoot) {
      return 0.75
    }

    let harmonicCount = 0
    for (const other of this._activeTracksCache) {
      if (other.id === track.id) continue
      if (other.harmonicOfHz !== null) {
        const cents = Math.abs(hzToCents(other.harmonicOfHz, track.trueFrequencyHz))
        if (cents < HARMONIC_ROOT_TOLERANCE_CENTS) {
          harmonicCount++
        }
      }
    }

    return Math.min(harmonicCount / MAX_HARMONICS_FOR_SCORE, 1)
  }

  private resolveMinQ(historyState: TrackHistoryState): number {
    if (!historyState.minQDirty) {
      return historyState.minQ
    }

    let minQ = Infinity
    for (let i = 0; i < historyState.count; i++) {
      const qEstimate = getHistoryEntry(historyState, i).qEstimate
      if (qEstimate < minQ) minQ = qEstimate
    }

    historyState.minQ = minQ === Infinity ? 10 : minQ
    historyState.minQDirty = false
    return historyState.minQ
  }

  private computeModulationScore(historyState: TrackHistoryState): number {
    const recentCount = Math.min(historyState.count, MAX_MODULATION_SAMPLES)
    if (recentCount < MIN_MODULATION_SAMPLES) return 0

    const startIndex = historyState.count - recentCount
    let meanFreq = 0
    for (let i = startIndex; i < historyState.count; i++) {
      meanFreq += getHistoryEntry(historyState, i).freqHz
    }
    meanFreq /= recentCount

    const deviations = this._deviationScratch
    let devMean = 0
    let devM2 = 0

    for (let i = 0; i < recentCount; i++) {
      const deviation = getHistoryEntry(historyState, startIndex + i).freqHz - meanFreq
      deviations[i] = deviation

      const sampleCount = i + 1
      const delta = deviation - devMean
      devMean += delta / sampleCount
      const delta2 = deviation - devMean
      devM2 += delta * delta2
    }

    const first = getHistoryEntry(historyState, startIndex)
    const last = getHistoryEntry(historyState, historyState.count - 1)
    const totalTime = last.time - first.time
    const avgStepMs = totalTime / (recentCount - 1)
    if (avgStepMs <= 0) return 0

    const minLag = Math.floor(100 / avgStepMs)
    const maxLag = Math.ceil(333 / avgStepMs)

    let maxAutocorr = 0
    for (let lag = minLag; lag <= maxLag && lag < recentCount / 2; lag++) {
      let sum = 0
      let sumSq1 = 0
      let sumSq2 = 0

      for (let i = 0; i < recentCount - lag; i++) {
        const a = deviations[i]
        const b = deviations[i + lag]
        sum += a * b
        sumSq1 += a * a
        sumSq2 += b * b
      }

      const denom = Math.sqrt(sumSq1 * sumSq2)
      const autocorr = denom > 0 ? sum / denom : 0
      if (autocorr > maxAutocorr) {
        maxAutocorr = autocorr
      }
    }

    const freqStd = Math.sqrt(devM2 / (recentCount - 1))
    return freqStd > 2 ? maxAutocorr : 0
  }

  private findNearestTrack(frequencyHz: number): Track | null {
    let nearest: Track | null = null
    let minCents = Infinity

    for (const track of this._activeTracksCache) {
      const cents = Math.abs(hzToCents(frequencyHz, track.trueFrequencyHz))
      if (cents < minCents) {
        minCents = cents
        nearest = track
      }
    }

    return nearest
  }

  private trackToTrackSummary(track: Track, target?: TrackSummary): TrackSummary {
    const summary = target ?? createTrackSummaryShell()
    summary.id = track.id
    summary.frequency = track.trueFrequencyHz
    summary.amplitude = track.trueAmplitudeDb
    summary.prominenceDb = track.prominenceDb
    summary.qEstimate = track.qEstimate
    summary.bandwidthHz = track.bandwidthHz
    summary.qMeasurementMode = track.qMeasurementMode
    summary.classification = 'unknown' as Severity
    summary.severity = 'unknown' as Severity
    summary.onsetTime = track.onsetTime
    summary.onsetAmplitudeDb = track.onsetDb
    summary.lastUpdateTime = track.lastUpdateTime
    summary.active = track.isActive
    summary.features.stabilityCentsStd = track.features.stabilityCentsStd
    summary.features.harmonicityScore = track.features.harmonicityScore
    summary.features.modulationScore = track.features.modulationScore
    summary.features.velocityDbPerSec = track.velocityDbPerSec
    summary.msd = track.msd
    summary.msdIsHowl = track.msdIsHowl
    summary.persistenceFrames = track.persistenceFrames
    return summary
  }

  private trackToTrackedPeak(track: Track): TrackedPeak {
    return {
      ...this.trackToTrackSummary(track),
      history: track.history.map((entry) => ({
        time: entry.time,
        frequency: entry.freqHz,
        amplitude: entry.ampDb,
      })),
    }
  }
}
