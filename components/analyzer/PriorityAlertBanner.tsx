'use client'

import { Radio, TriangleAlert } from 'lucide-react'
import { useAdvisoryData } from '@/contexts/AdvisoryContext'
import { useEarlyWarningPanelState } from '@/hooks/useEarlyWarningPanelState'
import { getSeverityText } from '@/lib/utils/advisoryDisplay'
import { formatFrequency } from '@/lib/utils/pitchUtils'
import { cn } from '@/lib/utils'
import type { Advisory } from '@/types/advisory'

interface PriorityAlertBannerProps {
  onViewIssues: () => void
  className?: string
}

export function getPriorityAdvisory(
  advisories: readonly Advisory[],
  dismissedIds: ReadonlySet<string>,
): Advisory | null {
  const urgent = advisories.filter((advisory) =>
    !advisory.resolved &&
    advisory.lifecycle !== 'provisional' &&
    !dismissedIds.has(advisory.id) &&
    (advisory.severity === 'RUNAWAY' || advisory.severity === 'GROWING'),
  )
  return urgent.find((advisory) => advisory.severity === 'RUNAWAY') ?? urgent[0] ?? null
}

export function PriorityAlertBanner({
  onViewIssues,
  className,
}: PriorityAlertBannerProps) {
  const { advisories, dismissedIds, earlyWarning } = useAdvisoryData()
  const lead = getPriorityAdvisory(advisories, dismissedIds)
  const warningState = useEarlyWarningPanelState(earlyWarning)
  const showEarlyWarning = !lead && warningState.isVisible && warningState.tone !== 'notice'

  if (!lead && !showEarlyWarning) return null

  const isRunaway = lead?.severity === 'RUNAWAY'
  const label = lead ? getSeverityText(lead.severity) : 'Early Warning'
  const frequency = lead?.trueFrequencyHz ?? earlyWarning?.predictedFrequencies[0]
  if (frequency === undefined) return null

  return (
    <div
      role={isRunaway ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-2 rounded border px-2 py-1.5 shadow-lg backdrop-blur-sm',
        isRunaway
          ? 'border-red-500/50 bg-red-950/90 text-red-100'
          : 'border-amber-500/40 bg-amber-950/90 text-amber-100',
        className,
      )}
    >
      {isRunaway
        ? <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        : <Radio className="size-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1 font-mono">
        <div className="text-dwa-sm font-semibold uppercase tracking-wide">{label}</div>
        <div className="truncate text-dwa-xs opacity-80">
          {formatFrequency(frequency)} · {lead ? Math.round(lead.confidence * 100) : warningState.confidencePct}%
        </div>
      </div>
      <button
        type="button"
        onClick={onViewIssues}
        className="min-h-11 min-w-11 shrink-0 rounded px-2 text-dwa-sm font-medium underline underline-offset-2 outline-none hover:bg-white/10 focus-visible:ring-[3px] focus-visible:ring-primary"
      >
        View issue
      </button>
    </div>
  )
}
