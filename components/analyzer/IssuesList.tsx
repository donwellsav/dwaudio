'use client'

import { useEffect, useMemo, useState, memo } from 'react'
import { useTheme } from 'next-themes'
import { X } from 'lucide-react'
import { getSeverityText, getSeverityColor } from '@/lib/utils/advisoryDisplay'
import { summarizeShelfRecommendations } from '@/lib/utils/recommendationDisplay'
import type { Advisory } from '@/types/advisory'
import { useIssueAnnouncement } from '@/hooks/useIssueAnnouncement'
import {
  useIssuesListEntries,
  useStableIssueEntries,
} from '@/hooks/useIssuesListEntries'
import { IssueCard } from './IssueCard'
import { IssuesEmptyState } from './IssuesEmptyState'
import { SEVERITY_ICON } from '@/components/analyzer/issueCardConfig'
import type { SpectrumStatus } from '@/hooks/audioAnalyzerTypes'

interface IssuesListProps {
  advisories: Advisory[]
  maxIssues?: number
  dismissedIds?: Set<string>
  onClearAll?: () => void
  onClearResolved?: () => void
  touchFriendly?: boolean
  isRunning?: boolean
  onStart?: () => void
  isLowSignal?: boolean
  spectrumStatus?: SpectrumStatus | null
  noiseFloorDb?: number | null
  showAlgorithmScores?: boolean
  showPeqDetails?: boolean
  onDismiss?: (id: string) => void
}

interface TonalIssueSummaryProps {
  summary: string
}

const TonalIssueSummary = memo(function TonalIssueSummary({
  summary,
}: TonalIssueSummaryProps) {
  const [isDismissed, setIsDismissed] = useState(false)

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setIsDismissed(true)
    }, 10_000)

    return () => window.clearTimeout(timerId)
  }, [])

  if (isDismissed) return null

  return (
    <div className="rounded border border-blue-500/20 bg-blue-500/5 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <div className="font-mono text-dwa-sm font-bold tracking-[0.15em] uppercase text-blue-400">
          Broad Tonal Note
        </div>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          aria-label="Dismiss broad tonal note"
          title="Dismiss broad tonal note"
          className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-blue-300/70 hover:text-blue-200 hover:bg-blue-500/10 transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <p
        className="mt-0.5 text-dwa-sm font-mono text-blue-300/80 leading-snug"
        title={summary}
      >
        {summary}
      </p>
    </div>
  )
})

export const IssuesList = memo(function IssuesList({
  advisories,
  maxIssues = 10,
  dismissedIds,
  onClearAll,
  onClearResolved,
  touchFriendly,
  isRunning,
  onStart,
  isLowSignal,
  spectrumStatus,
  noiseFloorDb,
  showAlgorithmScores,
  showPeqDetails,
  onDismiss,
}: IssuesListProps) {
  const latestEntries = useIssuesListEntries(advisories, dismissedIds, maxIssues)
  const sortedEntries = useStableIssueEntries(latestEntries)
  const liveAnnouncement = useIssueAnnouncement(sortedEntries)

  const hasResolved = useMemo(
    () => sortedEntries.some((entry) => entry.advisory.resolved),
    [sortedEntries],
  )
  const tonalIssueSummary = useMemo(() => {
    for (const entry of sortedEntries) {
      const advisorySummary = entry.advisory.advisory?.tonalIssueSummary
      if (advisorySummary) return advisorySummary

      const derivedSummary = summarizeShelfRecommendations(
        entry.advisory.advisory?.shelves ?? [],
      )
      if (derivedSummary) return derivedSummary
    }
    return null
  }, [sortedEntries])
  return (
    <div className="flex flex-col gap-1.5">
      <div className="sr-only" aria-live="polite" aria-atomic="true" role="status">
        {liveAnnouncement}
      </div>

      {sortedEntries.length === 0 ? (
        <IssuesEmptyState
          isRunning={isRunning}
          isLowSignal={isLowSignal}
          spectrumStatus={spectrumStatus}
          noiseFloorDb={noiseFloorDb}
          onStart={onStart}
        />
      ) : (
        <>
          {tonalIssueSummary ? (
            <TonalIssueSummary key={tonalIssueSummary} summary={tonalIssueSummary} />
          ) : null}

          {sortedEntries.length > 1 ? (
            <div className="flex items-center justify-end gap-2">
              {onClearResolved && hasResolved ? (
                <button
                  onClick={onClearResolved}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wide"
                >
                  Clear Done
                </button>
              ) : null}
              {onClearAll ? (
                <button
                  onClick={onClearAll}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wide"
                >
                  Clear All
                </button>
              ) : null}
            </div>
          ) : null}

          {sortedEntries.map(({ advisory, occurrenceCount, isHeld }) => (
            <IssueCard
              key={advisory.id}
              advisory={advisory}
              occurrenceCount={occurrenceCount}
              isHeld={isHeld}
              touchFriendly={touchFriendly}
              showAlgorithmScores={showAlgorithmScores}
              showPeqDetails={showPeqDetails}
              onDismiss={onDismiss}
            />
          ))}

          <SeverityLegend />
        </>
      )}
    </div>
  )
})

const LEGEND_SEVERITIES = [
  'RUNAWAY',
  'GROWING',
  'RESONANCE',
  'POSSIBLE_RING',
  'WHISTLE',
  'INSTRUMENT',
] as const

const SeverityLegend = memo(function SeverityLegend() {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 pb-0.5 border-t border-border/30 mt-1">
      {LEGEND_SEVERITIES.map((severity) => {
        const Icon = SEVERITY_ICON[severity]
        const color = getSeverityColor(severity, isDark)
        if (!Icon) return null

        return (
          <span
            key={severity}
            className="inline-flex items-center gap-1 text-dwa-sm font-mono tracking-wide leading-none"
            style={{ color }}
          >
            <Icon className="w-2.5 h-2.5" />
            {getSeverityText(severity)}
          </span>
        )
      })}
    </div>
  )
})
