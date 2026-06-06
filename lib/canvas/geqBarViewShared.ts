import { getSeverityColor } from '@/lib/utils/advisoryDisplay'
import type { Advisory } from '@/types/advisory'

export const GEQ_BAND_LABELS = [
  '20', '25', '31.5', '40', '50', '63', '80', '100', '125', '160',
  '200', '250', '315', '400', '500', '630', '800', '1k', '1.25k', '1.6k',
  '2k', '2.5k', '3.15k', '4k', '5k', '6.3k', '8k', '10k', '12.5k', '16k', '20k',
] as const

export interface BandRecommendation {
  suggestedDb: number
  color: string
  freq: number
  clusterCount: number
}

export interface GEQHoverLayout {
  paddingLeft: number
  barSpacing: number
  numBands: number
}

export function buildBandRecommendations(
  advisories: readonly Advisory[],
  clearedIds: ReadonlySet<string> | undefined,
  isDark: boolean,
): Map<number, BandRecommendation> {
  const map = new Map<number, BandRecommendation>()

  for (const advisory of advisories) {
    if (advisory.lifecycle === 'provisional') {
      continue
    }
    if (clearedIds?.has(advisory.id)) {
      continue
    }
    if (!advisory.advisory?.geq) {
      continue
    }

    const bandIndex = advisory.advisory.geq.bandIndex
    const advisoryClusterCount = advisory.clusterCount ?? 1
    const existing = map.get(bandIndex)

    if (!existing || advisory.advisory.geq.suggestedDb < existing.suggestedDb) {
      map.set(bandIndex, {
        suggestedDb: advisory.advisory.geq.suggestedDb,
        color: getSeverityColor(advisory.severity, isDark),
        freq: advisory.trueFrequencyHz,
        clusterCount: existing
          ? existing.clusterCount + advisoryClusterCount
          : advisoryClusterCount,
      })
      continue
    }

    existing.clusterCount += advisoryClusterCount
  }

  return map
}

export function buildGEQAriaLabel(
  bandRecommendations: ReadonlyMap<number, BandRecommendation>,
): string {
  if (bandRecommendations.size === 0) {
    return 'Graphic equalizer: no active cuts'
  }

  const cuts = Array.from(bandRecommendations.entries())
    .map(([bandIndex, recommendation]) => `${GEQ_BAND_LABELS[bandIndex]} Hz ${recommendation.suggestedDb}dB`)
    .join(', ')

  return `Graphic equalizer: ${bandRecommendations.size} active cuts. ${cuts}`
}
