'use client'

import { useCallback, useEffect, useMemo, useState, memo } from 'react'
import { X } from 'lucide-react'
import { summarizeShelfRecommendations } from '@/lib/utils/recommendationDisplay'
import type { Advisory } from '@/types/advisory'
import { useIssueAnnouncement } from '@/hooks/useIssueAnnouncement'
import {
  useIssuesListEntries,
  useStableIssueEntries,
} from '@/hooks/useIssuesListEntries'
import { IssueCard } from './IssueCard'
import { IssuesEmptyState } from './IssuesEmptyState'
import type { SpectrumStatus } from '@/hooks/audioAnalyzerTypes'

interface IssuesListProps {
  advisories: Advisory[]
  maxIssues?: number
  dismissedIds?: Set<string>
  lastDismissedId?: string | null
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
  onRestoreDismissed?: (id: string) => void
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
  lastDismissedId = null,
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
  onRestoreDismissed,
}: IssuesListProps) {
  const latestEntries = useIssuesListEntries(advisories, dismissedIds, maxIssues)
  const sortedEntries = useStableIssueEntries(latestEntries)
  const visibleEntries = useMemo(
    () => sortedEntries.filter((entry) => !dismissedIds?.has(entry.advisory.id)),
    [dismissedIds, sortedEntries],
  )
  const liveAnnouncement = useIssueAnnouncement(sortedEntries)

  const handleUndo = useCallback(() => {
    if (lastDismissedId === null || !onRestoreDismissed) return
    onRestoreDismissed(lastDismissedId)
  }, [lastDismissedId, onRestoreDismissed])

  const canUndoDismissal = lastDismissedId !== null &&
    dismissedIds?.has(lastDismissedId) === true &&
    advisories.some((advisory) => advisory.id === lastDismissedId)

  const hiddenActiveIssueCount = useMemo(
    () => advisories.filter((advisory) =>
      !advisory.resolved &&
      advisory.lifecycle !== 'provisional' &&
      dismissedIds?.has(advisory.id),
    ).length,
    [advisories, dismissedIds],
  )

  const hasResolved = useMemo(
    () => visibleEntries.some((entry) => entry.advisory.resolved),
    [visibleEntries],
  )
  const tonalIssueSummary = useMemo(() => {
    for (const entry of visibleEntries) {
      const advisorySummary = entry.advisory.advisory?.tonalIssueSummary
      if (advisorySummary) return advisorySummary

      const derivedSummary = summarizeShelfRecommendations(
        entry.advisory.advisory?.shelves ?? [],
      )
      if (derivedSummary) return derivedSummary
    }
    return null
  }, [visibleEntries])
  return (
    <div className="flex flex-col gap-1.5">
      <div className="sr-only" aria-live="polite" aria-atomic="true" role="status">
        {liveAnnouncement}
      </div>

      {canUndoDismissal ? (
        <div role="status" className="flex min-h-11 items-center gap-2 rounded border border-border/50 bg-card/60 px-3 text-dwa-sm font-mono text-muted-foreground">
          <span>Issue dismissed.</span>
          <button type="button" className="ml-auto min-h-11 px-3 text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={handleUndo}>
            Undo
          </button>
        </div>
      ) : null}

      {visibleEntries.length === 0 ? (
        isRunning && hiddenActiveIssueCount > 0 ? (
          <div role="status" className="flex min-h-[80px] flex-col items-center justify-center gap-1 px-3 py-4 text-center font-mono">
            <div className="text-dwa-sm font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Issues Hidden
            </div>
            <div className="text-dwa-xs text-muted-foreground/70">
              {hiddenActiveIssueCount} active {hiddenActiveIssueCount === 1 ? 'issue' : 'issues'} hidden from this view.
            </div>
          </div>
        ) : (
          <IssuesEmptyState
            isRunning={isRunning}
            isLowSignal={isLowSignal}
            spectrumStatus={spectrumStatus}
            noiseFloorDb={noiseFloorDb}
            onStart={onStart}
          />
        )
      ) : (
        <>
          {tonalIssueSummary ? (
            <TonalIssueSummary key={tonalIssueSummary} summary={tonalIssueSummary} />
          ) : null}

          {visibleEntries.length > 1 ? (
            <div className="flex items-center justify-end gap-2">
              {onClearResolved && hasResolved ? (
                <button type="button"
                  onClick={onClearResolved}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wide"
                >
                  Clear Done
                </button>
              ) : null}
              {onClearAll ? (
                <button type="button"
                  onClick={onClearAll}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wide"
                >
                  Clear All
                </button>
              ) : null}
            </div>
          ) : null}

          {visibleEntries.map(({ advisory, occurrenceCount, isHeld }) => (
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
        </>
      )}
    </div>
  )
})
