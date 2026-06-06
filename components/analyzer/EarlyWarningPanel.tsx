'use client'

import { memo } from 'react'
import { ChevronDown, ChevronRight, Radio } from 'lucide-react'
import {
  useEarlyWarningPanelState,
  type EarlyWarningTone,
} from '@/hooks/useEarlyWarningPanelState'
import { formatFrequency } from '@/lib/utils/pitchUtils'
import type { EarlyWarning } from '@/hooks/audioAnalyzerTypes'

interface EarlyWarningPanelProps {
  earlyWarning: EarlyWarning | null
}

const ELAPSED_TONE_CLASSNAME: Record<EarlyWarningTone, string> = {
  notice: 'text-amber-700 dark:text-amber-400',
  warning: 'text-amber-800 dark:text-amber-300',
  critical: 'text-red-700 dark:text-red-400',
}

const PROGRESS_TONE_CLASSNAME: Record<EarlyWarningTone, string> = {
  notice: 'bg-amber-500/60 dark:bg-amber-400/40',
  warning: 'bg-amber-600/70 dark:bg-amber-400/70',
  critical: 'bg-red-600/70 dark:bg-red-400/70',
}

export const EarlyWarningPanel = memo(function EarlyWarningPanel({ earlyWarning }: EarlyWarningPanelProps) {
  const {
    isVisible,
    isExpanded,
    elapsedSec,
    confidencePct,
    progressPercent,
    tone,
    toggleExpanded,
  } = useEarlyWarningPanelState(earlyWarning)

  if (!earlyWarning || !isVisible) return null

  const { predictedFrequencies, fundamentalSpacing, estimatedPathLength } = earlyWarning

  return (
    <div className="mt-2 rounded border border-amber-400 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/5 overflow-hidden">
      <button type="button"
        onClick={toggleExpanded}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-amber-800 dark:text-amber-400 font-medium uppercase tracking-wide hover:bg-amber-100 dark:hover:bg-amber-500/10 transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-amber-500/50"
        aria-expanded={isExpanded}
      >
        <Radio className="w-3 h-3" aria-hidden="true" />
        <span>Early Warning</span>
        {elapsedSec > 0 && (
          <span className={`font-mono text-sm tabular-nums ${ELAPSED_TONE_CLASSNAME[tone]}`}>
            {elapsedSec}s
          </span>
        )}
        <span className="ml-auto font-mono text-amber-800 dark:text-amber-400">{confidencePct}%</span>
        {isExpanded
          ? <ChevronDown className="w-3 h-3 text-amber-700/60 dark:text-amber-400/50" />
          : <ChevronRight className="w-3 h-3 text-amber-700/60 dark:text-amber-400/50" />
        }
      </button>

      {isExpanded && (
        <div className="px-2.5 pb-2 space-y-1.5">
          {/* Predicted frequencies */}
          <div className="flex flex-wrap gap-1">
            {predictedFrequencies.slice(0, 6).map((freq) => (
              <span
                key={freq}
                className="text-sm font-mono px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20"
              >
                {formatFrequency(freq)}
              </span>
            ))}
          </div>

          {/* Details row */}
          <div className="flex items-center gap-3 text-sm text-amber-800/70 dark:text-amber-400/60 font-mono">
            {fundamentalSpacing && (
              <span>Spacing: {fundamentalSpacing.toFixed(0)} Hz</span>
            )}
            {estimatedPathLength && (
              <span>Path: {estimatedPathLength.toFixed(1)} m</span>
            )}
          </div>

          {/* Persistence indicator — fills over 15s to show urgency */}
          {elapsedSec > 0 && (
            <div className="h-1 rounded-full bg-amber-500/20 dark:bg-amber-500/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-[background-color,width] duration-500 ease-linear ${PROGRESS_TONE_CLASSNAME[tone]}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
})
