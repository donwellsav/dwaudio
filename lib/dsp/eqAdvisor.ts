// DoneWell Audio EQ Advisor - GEQ/PEQ recommendations with pitch translation

import { ISO_31_BANDS, EQ_PRESETS, ERB_SETTINGS, SPECTRAL_TRENDS, VIZ_COLORS, VIZ_COLORS_LIGHT } from './constants'
import { hzToPitch, formatFrequencyRange, formatPitch } from '@/lib/utils/pitchUtils'
import { clamp } from '@/lib/utils/mathHelpers'
import { summarizeShelfRecommendations } from '@/lib/utils/recommendationDisplay'
import type { 
  Track, 
  TrackedPeak,
  SeverityLevel, 
  Preset,
  GEQRecommendation, 
  PEQRecommendation, 
  ShelfRecommendation,
  EQAdvisory,
  RecommendationContext,
  QMeasurementMode,
} from '@/types/advisory'

// Track input type that works with both Track and TrackedPeak
type TrackInput = Track | TrackedPeak

interface QRecommendationPolicy {
  q: number
  strategy: PEQRecommendation['strategy']
  reason?: string
  qSource: NonNullable<PEQRecommendation['qSource']>
}

const MIN_RECOMMENDED_Q = 4
const MAX_RECOMMENDED_Q = 16
const LOW_FREQUENCY_REGION_HZ = 300
const LOW_FREQUENCY_Q_CAP = 8
const RECURRENCE_WIDENING_FACTOR = 0.85

// Helper to get frequency from either type
function getTrackFrequency(track: TrackInput): number {
  return 'trueFrequencyHz' in track ? track.trueFrequencyHz : track.frequency
}

function getTrackQ(track: TrackInput): number {
  return track.qEstimate
}

function getTrackMeasurementMode(track: TrackInput): QMeasurementMode {
  return track.qMeasurementMode ?? 'full'
}

function getTrackMeanQ(track: TrackInput): number | undefined {
  const features = track.features as Partial<Track['features']>
  if (typeof features.meanQ !== 'number' || !Number.isFinite(features.meanQ) || features.meanQ <= 0) {
    return undefined
  }
  return features.meanQ
}

function getTrustedMeasuredQ(track: TrackInput): number | undefined {
  if (getTrackMeasurementMode(track) !== 'full') return undefined

  const meanQ = getTrackMeanQ(track)
  if (meanQ !== undefined) {
    return clamp(meanQ, MIN_RECOMMENDED_Q, MAX_RECOMMENDED_Q)
  }

  const qEstimate = getTrackQ(track)
  if (!Number.isFinite(qEstimate) || qEstimate <= 0) return undefined
  return clamp(qEstimate, MIN_RECOMMENDED_Q, MAX_RECOMMENDED_Q)
}

function getBaselineQ(severity: SeverityLevel, preset: Preset): number {
  const baselines: Record<Preset, Record<'RUNAWAY' | 'GROWING' | 'RESONANCE' | 'POSSIBLE_RING', number>> = {
    surgical: {
      RUNAWAY: 16,
      GROWING: 12,
      RESONANCE: 9,
      POSSIBLE_RING: 7,
    },
    heavy: {
      RUNAWAY: 12,
      GROWING: 9,
      RESONANCE: 6,
      POSSIBLE_RING: 4,
    },
  }

  switch (severity) {
    case 'RUNAWAY':
    case 'GROWING':
    case 'RESONANCE':
    case 'POSSIBLE_RING':
      return baselines[preset][severity]
    default:
      return baselines[preset].RESONANCE
  }
}

/**
 * Calculate ERB (Equivalent Rectangular Bandwidth) at a given frequency.
 * Glasberg & Moore (1990): ERB(f) = 24.7 * (4.37 * f/1000 + 1)
 *
 * Notches narrower than one ERB are psychoacoustically transparent.
 * This means we can cut deeper at high frequencies (where ERB is wider
 * relative to the notch) and should cut shallower at low frequencies
 * (where our notch eats into audible bandwidth).
 */
export function calculateERB(frequencyHz: number): number {
  return 24.7 * (4.37 * frequencyHz / 1000 + 1)
}

/**
 * Frequency-dependent depth scaling based on ERB psychoacoustics.
 * Returns a multiplier for cut depth:
 * - Below 500 Hz: 0.7 (30% shallower — protect warmth)
 * - 500-2000 Hz: 1.0 (speech range, full depth)
 * - Above 2000 Hz: up to 1.2 (20% deeper — notch is more transparent)
 *
 * Smooth interpolation at boundaries via linear ramp.
 */
// Pre-computed ERB log2 constants (used by erbDepthScale)
const _LOG2_LOW_FREQ = Math.log2(ERB_SETTINGS.LOW_FREQ_HZ)
const _INV_LOG2_RANGE = 1 / (Math.log2(ERB_SETTINGS.HIGH_FREQ_HZ) - _LOG2_LOW_FREQ)
const _ERB_SCALE_RANGE = ERB_SETTINGS.HIGH_FREQ_SCALE - ERB_SETTINGS.LOW_FREQ_SCALE

// Quantized ERB cache — 10 buckets per octave across ~8 octaves (100–12000 Hz) ≈ 80 entries.
// Eliminates Math.log2 per call (~120 calls/sec) after first encounter.
const _erbCache = new Map<number, number>()
const _ERB_QUANT_FACTOR = 10 // buckets per octave → ~12 Hz resolution at 100 Hz, ~120 Hz at 10 kHz

export function erbDepthScale(frequencyHz: number): number {
  if (frequencyHz <= ERB_SETTINGS.LOW_FREQ_HZ) {
    return ERB_SETTINGS.LOW_FREQ_SCALE
  }
  if (frequencyHz >= ERB_SETTINGS.HIGH_FREQ_HZ) {
    return ERB_SETTINGS.HIGH_FREQ_SCALE
  }
  // Quantize to nearest 1/10th octave for cache lookup
  const bucket = Math.round(Math.log2(frequencyHz) * _ERB_QUANT_FACTOR)
  const cached = _erbCache.get(bucket)
  if (cached !== undefined) return cached
  const t = (Math.log2(frequencyHz) - _LOG2_LOW_FREQ) * _INV_LOG2_RANGE
  const result = ERB_SETTINGS.LOW_FREQ_SCALE + t * _ERB_SCALE_RANGE
  _erbCache.set(bucket, result)
  return result
}

/**
 * Find nearest ISO 31-band to a given frequency
 */
// Pre-computed log2 of ISO 31 bands — saves 31 Math.log2 calls per lookup
const _ISO_31_BANDS_LOG2 = ISO_31_BANDS.map(f => Math.log2(f))

// GEQ band lookup cache — keyed by quantized log2 bucket (same as ERB cache).
// 31 bands × ~80 quantized buckets → at most ~80 cache entries, then all hits.
const _geqBandCache = new Map<number, { bandHz: number; bandIndex: number }>()

export function findNearestGEQBand(freqHz: number): { bandHz: number; bandIndex: number } {
  const bucket = Math.round(Math.log2(freqHz) * _ERB_QUANT_FACTOR)
  const cached = _geqBandCache.get(bucket)
  if (cached !== undefined) return cached

  let minDist = Infinity
  let nearestIndex = 0
  const logFreq = Math.log2(freqHz)

  for (let i = 0; i < _ISO_31_BANDS_LOG2.length; i++) {
    const dist = Math.abs(logFreq - _ISO_31_BANDS_LOG2[i])
    if (dist < minDist) {
      minDist = dist
      nearestIndex = i
    }
  }

  const result = { bandHz: ISO_31_BANDS[nearestIndex], bandIndex: nearestIndex }
  _geqBandCache.set(bucket, result)
  return result
}

/**
 * Calculate recommended cut depth based on severity, preset, and optional
 * recurrence count. Implements MINDS-inspired adaptive depth: the first
 * detection gets a light cut, but if feedback recurs at the same frequency
 * the notch progressively deepens (capped at preset maxCut).
 *
 * @param severity - Current severity level
 * @param preset - EQ preset (surgical / heavy)
 * @param recurrenceCount - How many times feedback has recurred at this freq (0 = first time)
 */
export function calculateCutDepth(severity: SeverityLevel, preset: Preset, recurrenceCount: number = 0): number {
  const presetConfig = EQ_PRESETS[preset]

  let baseDepth: number
  switch (severity) {
    case 'RUNAWAY':
      baseDepth = presetConfig.maxCut // -18 or -12 dB
      break
    case 'GROWING':
      baseDepth = presetConfig.maxCut // Same as RUNAWAY — if it's growing, kill it
      break
    case 'RESONANCE':
      baseDepth = presetConfig.moderateCut // -9 or -6 dB
      break
    case 'POSSIBLE_RING':
      baseDepth = presetConfig.moderateCut // Match resonance — detected means cut
      break
    case 'WHISTLE':
      return 0 // No cut for whistles
    case 'INSTRUMENT':
      return 0 // No cut for instruments
    default:
      baseDepth = presetConfig.moderateCut
  }

  // MINDS-inspired adaptive depth: each recurrence deepens by 2 dB
  // capped at the preset's maxCut to avoid over-cutting
  if (recurrenceCount > 0) {
    const adaptiveDepth = baseDepth - (recurrenceCount * 2)
    return clamp(adaptiveDepth, presetConfig.maxCut, 0)
  }

  return clamp(baseDepth, presetConfig.maxCut, 0)
}

function resolveRecommendationContext(
  recommendationContext?: RecommendationContext,
): RecommendationContext {
  return {
    recurrenceCount: recommendationContext?.recurrenceCount ?? 0,
  }
}

function resolveBaseCutDepth(
  severity: SeverityLevel,
  preset: Preset,
  recommendationContext?: RecommendationContext,
): number {
  const presetConfig = EQ_PRESETS[preset]
  const context = resolveRecommendationContext(recommendationContext)
  const effectiveDepth = calculateCutDepth(severity, preset, context.recurrenceCount)

  return clamp(effectiveDepth, presetConfig.maxCut, 0)
}

function clampSuggestedCutDb(suggestedDb: number, preset: Preset): number {
  return clamp(Math.round(suggestedDb), EQ_PRESETS[preset].maxCut, 0)
}

/**
 * Calculate recommended Q policy for PEQ based on severity, measured width,
 * merged region span, and guard rails.
 */
export function calculateQ(
  track: TrackInput,
  severity: SeverityLevel,
  preset: Preset,
  recommendationContext?: RecommendationContext,
  clusterMinHz?: number,
  clusterMaxHz?: number,
): QRecommendationPolicy {
  const freqHz = getTrackFrequency(track)
  const measurementMode = getTrackMeasurementMode(track)
  const normalizedContext = resolveRecommendationContext(recommendationContext)
  const baselineQ = getBaselineQ(severity, preset)
  const measuredQ = getTrustedMeasuredQ(track)
  const defaultNarrowQ =
    measuredQ !== undefined
      ? measuredQ * 0.7 + baselineQ * 0.3
      : baselineQ

  let q = defaultNarrowQ
  let strategy: PEQRecommendation['strategy'] = 'narrow-cut'
  let reason: string | undefined
  let qSource: NonNullable<PEQRecommendation['qSource']> =
    measuredQ !== undefined ? 'measured' : 'baseline'

  const hasClusterBounds =
    clusterMinHz !== undefined &&
    clusterMaxHz !== undefined &&
    clusterMinHz < clusterMaxHz

  if (hasClusterBounds) {
    const clusterQ = clusterAwareQ(q, freqHz, clusterMinHz, clusterMaxHz)
    if (clusterQ < q) {
      q = clusterQ
      qSource = 'cluster'
    }
    strategy = 'broad-region'
    reason = `Q widened to cover the broader unstable region from ${formatFrequencyRange(clusterMinHz, clusterMaxHz)}.`
  }

  if (measurementMode !== 'full') {
    const guardedQ = Math.min(q, baselineQ)
    if (guardedQ < q || qSource !== 'cluster') {
      qSource = 'guarded'
    }
    q = guardedQ
    const measurementReason = 'Bandwidth estimate was incomplete, so Q was kept conservative instead of inferring a razor-thin notch.'
    reason = reason ? `${reason} ${measurementReason}` : measurementReason
  }

  const lowFrequencyCapApplied = freqHz < LOW_FREQUENCY_REGION_HZ && q > LOW_FREQUENCY_Q_CAP
  if (freqHz < LOW_FREQUENCY_REGION_HZ) {
    q = Math.min(q, LOW_FREQUENCY_Q_CAP)
    strategy = 'broad-region'
    if (lowFrequencyCapApplied) {
      qSource = 'guarded'
    }
    const lowFrequencyReason = 'Low-frequency recurrence usually spans a broader unstable region, so Q was kept conservative.'
    reason = reason ? `${reason} ${lowFrequencyReason}` : lowFrequencyReason
  }

  if (normalizedContext.recurrenceCount >= 2) {
    q *= RECURRENCE_WIDENING_FACTOR
  }

  return {
    q: clamp(q, MIN_RECOMMENDED_Q, MAX_RECOMMENDED_Q),
    strategy,
    reason,
    qSource,
  }
}

/**
 * Generate GEQ recommendation for a track
 */
export function generateGEQRecommendation(
  track: TrackInput,
  severity: SeverityLevel,
  preset: Preset,
  recommendationContext?: RecommendationContext,
): GEQRecommendation {
  const { bandHz, bandIndex } = findNearestGEQBand(getTrackFrequency(track))
  const baseCut = resolveBaseCutDepth(severity, preset, recommendationContext)
  const suggestedDb = clampSuggestedCutDb(
    baseCut * erbDepthScale(getTrackFrequency(track)),
    preset,
  )

  return {
    bandHz,
    bandIndex,
    suggestedDb,
  }
}

/**
 * Widen Q to cover a cluster of nearby merged frequencies.
 *
 * Q = f_center / bandwidth. If the cluster spans Δf Hz, the minimum Q
 * to fully cover it is f_center / Δf. We apply a 1.5× bandwidth margin
 * so the notch envelopes the cluster edges rather than just touching them.
 *
 * Returns the wider (lower) of baseQ and the cluster-derived Q.
 */
export function clusterAwareQ(
  baseQ: number,
  centerHz: number,
  clusterMinHz?: number,
  clusterMaxHz?: number,
): number {
  if (!clusterMinHz || !clusterMaxHz || clusterMinHz >= clusterMaxHz) return baseQ
  const spanHz = clusterMaxHz - clusterMinHz
  const coverageQ = centerHz / (spanHz * 1.5) // 1.5× margin
  return clamp(Math.min(baseQ, coverageQ), MIN_RECOMMENDED_Q, MAX_RECOMMENDED_Q)
}

/**
 * Generate PEQ recommendation for a track.
 *
 * When `clusterMinHz`/`clusterMaxHz` are provided (merged advisory),
 * the Q is widened to cover the full cluster span.
 */
export function generatePEQRecommendation(
  track: TrackInput,
  severity: SeverityLevel,
  preset: Preset,
  recommendationContext?: RecommendationContext,
  clusterMinHz?: number,
  clusterMaxHz?: number,
): PEQRecommendation {
  const freqHz = getTrackFrequency(track)
  const baseCut = resolveBaseCutDepth(severity, preset, recommendationContext)
  const suggestedDb = clampSuggestedCutDb(baseCut * erbDepthScale(freqHz), preset)
  const qPolicy = calculateQ(track, severity, preset, recommendationContext, clusterMinHz, clusterMaxHz)
  // Pass through measured bandwidth from detector (if available)
  const measuredBandwidth = 'bandwidthHz' in track ? track.bandwidthHz : undefined

  // Determine filter type
  let type: PEQRecommendation['type'] = 'bell'
  let strategy = qPolicy.strategy
  let reason = qPolicy.reason

  if (severity === 'RUNAWAY') {
    // Use notch for runaway (very narrow, deep cut)
    type = 'notch'
  } else if (freqHz < 80) {
    // Suggest HPF for very low frequencies
    type = 'HPF'
    strategy = 'broad-region'
    const hpfReason = 'Low-frequency buildup is better handled with a broader filter than a narrow notch.'
    reason = reason ? `${reason} ${hpfReason}` : hpfReason
  } else if (freqHz > 12000) {
    // Suggest LPF for very high frequencies
    type = 'LPF'
    strategy = 'broad-region'
    const lpfReason = 'Top-end spill this high is usually better handled with a broader filter than a narrow notch.'
    reason = reason ? `${reason} ${lpfReason}` : lpfReason
  }

  return {
    type,
    hz: freqHz,
    q: qPolicy.q,
    gainDb: suggestedDb,
    bandwidthHz: measuredBandwidth,
    qSource: qPolicy.qSource,
    strategy,
    reason,
  }
}

/**
 * Post-process shelf array to enforce structural invariants:
 * - Max one shelf per type (HPF, lowShelf, highShelf)
 * - HPF frequency must be below lowShelf frequency (sanity check)
 * - Total shelf count capped at 3
 */
export function validateShelves(shelves: ShelfRecommendation[]): ShelfRecommendation[] {
  const seen = new Set<ShelfRecommendation['type']>()
  const validated: ShelfRecommendation[] = []

  for (const shelf of shelves) {
    // Reject duplicate types (keep first occurrence)
    if (seen.has(shelf.type)) continue
    seen.add(shelf.type)

    // Sanity: if lowShelf exists below HPF frequency, skip it
    if (shelf.type === 'lowShelf') {
      const hpf = validated.find(s => s.type === 'HPF')
      if (hpf && shelf.hz <= hpf.hz) continue
    }

    validated.push(shelf)
  }

  // Cap at 3 shelves (one per type max)
  return validated.slice(0, 3)
}

/**
 * Analyze spectrum for shelf/filter recommendations.
 *
 * Detects three broadband spectral issues:
 * - **Rumble** (< 80 Hz): recommends HPF
 * - **Mud** (200–400 Hz): recommends lowShelf at 300 Hz, -3 dB
 * - **Harshness** (6–10 kHz): recommends highShelf at 8 kHz, -3 dB
 *
 * When HPF is active, the lowShelf threshold is raised by 2 dB to
 * prevent overlapping attenuation in the 80–300 Hz region.
 */
export function analyzeSpectralTrends(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number
): ShelfRecommendation[] {
  const shelves: ShelfRecommendation[] = []
  const hzPerBin = sampleRate / fftSize
  const n = spectrum.length

  // Calculate average level
  let totalDb = 0
  for (let i = 0; i < n; i++) {
    totalDb += spectrum[i]
  }
  const avgDb = totalDb / n

  // Check low-end rumble
  const lowEndBin = Math.round(SPECTRAL_TRENDS.LOW_RUMBLE_THRESHOLD_HZ / hzPerBin)
  let lowSum = 0
  for (let i = 1; i < Math.min(lowEndBin, n); i++) {
    lowSum += spectrum[i]
  }
  const lowAvg = lowEndBin > 1 ? lowSum / (lowEndBin - 1) : avgDb

  let hasHPF = false
  if (lowAvg > avgDb + SPECTRAL_TRENDS.LOW_RUMBLE_EXCESS_DB) {
    shelves.push({
      type: 'HPF',
      hz: SPECTRAL_TRENDS.LOW_RUMBLE_THRESHOLD_HZ,
      gainDb: 0, // HPF doesn't have gain, but this indicates activation
      reason: `Low-end rumble detected (${(lowAvg - avgDb).toFixed(1)} dB excess below ${SPECTRAL_TRENDS.LOW_RUMBLE_THRESHOLD_HZ}Hz)`,
    })
    hasHPF = true
  }

  // Check mud buildup (200-400 Hz)
  // If HPF already active, require stronger mud evidence (+2 dB stricter)
  // to prevent overlapping attenuation in the 80–300 Hz region
  const mudThreshold = hasHPF
    ? SPECTRAL_TRENDS.MUD_EXCESS_DB + 2
    : SPECTRAL_TRENDS.MUD_EXCESS_DB

  const mudLowBin = Math.round(SPECTRAL_TRENDS.MUD_FREQ_LOW / hzPerBin)
  const mudHighBin = Math.round(SPECTRAL_TRENDS.MUD_FREQ_HIGH / hzPerBin)
  let mudSum = 0
  for (let i = mudLowBin; i < Math.min(mudHighBin, n); i++) {
    mudSum += spectrum[i]
  }
  const mudAvg = mudHighBin > mudLowBin ? mudSum / (mudHighBin - mudLowBin) : avgDb

  if (mudAvg > avgDb + mudThreshold) {
    shelves.push({
      type: 'lowShelf',
      hz: 300, // Center of mud range
      gainDb: -3,
      reason: `Mud buildup detected (${(mudAvg - avgDb).toFixed(1)} dB excess in 200-400Hz)`,
    })
  }

  // Check harshness (6-10 kHz)
  const harshLowBin = Math.round(SPECTRAL_TRENDS.HARSH_FREQ_LOW / hzPerBin)
  const harshHighBin = Math.round(SPECTRAL_TRENDS.HARSH_FREQ_HIGH / hzPerBin)
  let harshSum = 0
  for (let i = harshLowBin; i < Math.min(harshHighBin, n); i++) {
    harshSum += spectrum[i]
  }
  const harshAvg = harshHighBin > harshLowBin ? harshSum / (harshHighBin - harshLowBin) : avgDb

  if (harshAvg > avgDb + SPECTRAL_TRENDS.HARSH_EXCESS_DB) {
    // Spectral flatness guard: compute geometric/arithmetic mean ratio of
    // linear power in the harsh region. Flatness > 0.4 indicates broad
    // spectral elevation (e.g. vocal presence) rather than a narrow peak,
    // so skip the highShelf to avoid cutting beneficial brightness.
    const harshBinCount = Math.min(harshHighBin, n) - harshLowBin
    if (harshBinCount > 0) {
      let logSum = 0
      let linearSum = 0
      for (let i = harshLowBin; i < Math.min(harshHighBin, n); i++) {
        // Convert dB to linear power (spectrum values are in dB)
        const linear = Math.pow(10, spectrum[i] / 10)
        logSum += Math.log(linear)
        linearSum += linear
      }
      const geometricMean = Math.exp(logSum / harshBinCount)
      const arithmeticMean = linearSum / harshBinCount
      const flatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0

      if (flatness <= 0.4) {
        shelves.push({
          type: 'highShelf',
          hz: 8000,
          gainDb: -3,
          reason: `High-frequency harshness detected (${(harshAvg - avgDb).toFixed(1)} dB excess in 6-10kHz)`,
        })
      }
    }
  }

  return validateShelves(shelves)
}

/**
 * Generate complete EQ advisory for a track.
 *
 * @param precomputedShelves - Optional pre-computed shelf array. When provided,
 *   skips `analyzeSpectralTrends()` entirely — used by the worker to avoid
 *   re-analyzing the same global spectrum once per peak (cross-advisory dedup).
 */
export function generateEQAdvisory(
  track: TrackInput,
  severity: SeverityLevel,
  preset: Preset,
  spectrum?: Float32Array,
  sampleRate?: number,
  fftSize?: number,
  precomputedShelves?: ShelfRecommendation[],
  recommendationContext?: RecommendationContext,
): EQAdvisory {
  const freqHz = getTrackFrequency(track)
  const normalizedContext = resolveRecommendationContext(recommendationContext)
  const geq = generateGEQRecommendation(track, severity, preset, normalizedContext)
  const peq = generatePEQRecommendation(track, severity, preset, normalizedContext)
  const pitch = hzToPitch(freqHz)

  // Use pre-computed shelves if provided (cross-advisory dedup),
  // otherwise compute from spectrum
  let shelves: ShelfRecommendation[] = []
  if (precomputedShelves) {
    shelves = precomputedShelves
  } else if (spectrum && sampleRate && fftSize) {
    shelves = analyzeSpectralTrends(spectrum, sampleRate, fftSize)
  }

  return {
    geq,
    peq,
    shelves,
    pitch,
    recommendationContext: normalizedContext,
    tonalIssueSummary: summarizeShelfRecommendations(shelves) ?? undefined,
  }
}

/**
 * Format EQ recommendation as human-readable string
 */
export function formatEQRecommendation(advisory: EQAdvisory): string {
  const { geq, peq, pitch } = advisory

  const parts: string[] = []

  // GEQ recommendation
  if (geq.suggestedDb < 0) {
    parts.push(`GEQ: Pull ${geq.bandHz}Hz fader to ${geq.suggestedDb}dB`)
  }

  // PEQ recommendation
  if (peq.gainDb < 0) {
    const typeStr = peq.type === 'notch' ? 'Notch' : peq.type === 'bell' ? 'Bell' : peq.type
    parts.push(`PEQ: ${typeStr} at ${peq.hz.toFixed(1)}Hz, Q=${peq.q.toFixed(1)}, ${peq.gainDb}dB`)
    if (peq.reason) {
      parts.push(`Strategy: ${peq.reason}`)
    }
  }

  // Pitch info
  parts.push(`Pitch: ${formatPitch(pitch)}`)

  if (advisory.tonalIssueSummary) {
    parts.push(`Broad tonal note: ${advisory.tonalIssueSummary}`)
  }

  return parts.join(' | ')
}

/**
 * Get GEQ band labels for display
 */
export function getGEQBandLabels(): string[] {
  return ISO_31_BANDS.map(hz => {
    if (hz >= 1000) {
      return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k`
    }
    return `${hz}`
  })
}

/**
 * Get color for severity level.
 * @param isDark - true for dark theme (default), false for light theme with WCAG AA contrast
 */
export function getSeverityColor(severity: SeverityLevel, isDark: boolean = true): string {
  const colors = isDark ? VIZ_COLORS : { ...VIZ_COLORS, ...VIZ_COLORS_LIGHT }
  switch (severity) {
    case 'RUNAWAY': return colors.RUNAWAY
    case 'GROWING': return colors.GROWING
    case 'RESONANCE': return colors.RESONANCE
    case 'POSSIBLE_RING': return colors.POSSIBLE_RING
    case 'WHISTLE': return colors.WHISTLE
    case 'INSTRUMENT': return colors.INSTRUMENT
    default: return VIZ_COLORS.NOISE_FLOOR
  }
}
