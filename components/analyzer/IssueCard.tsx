'use client'

import { memo } from 'react'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import { confidenceColor, RUNAWAY_COLOR } from '@/lib/canvas/canvasTokens'
import { getSeverityText } from '@/lib/utils/advisoryDisplay'
import { getRecommendationStrategyLabel } from '@/lib/utils/recommendationDisplay'
import { badgeClass } from '@/lib/utils/badgeClasses'
import { useTickingNow } from '@/hooks/useTickingNow'
import { IssueCardActions } from './IssueCardActions'
import {
  SEVERITY_ENTER_CLASS,
  SEVERITY_ICON,
  SEVERITY_STRIP_CLASS,
} from '@/components/analyzer/issueCardConfig'
import { useIssueCardState } from '@/hooks/useIssueCardState'
import type { Advisory } from '@/types/advisory'

export interface IssueCardProps {
  advisory: Advisory
  occurrenceCount: number
  isHeld?: boolean
  touchFriendly?: boolean
  showAlgorithmScores?: boolean
  showPeqDetails?: boolean
  onDismiss?: (advisoryId: string) => void
}

function getIssueAgeSec(nowMs: number, timestampMs: number): number {
  const isWallClockTimestamp = timestampMs > 1_000_000_000_000
  if (!isWallClockTimestamp) return 0

  return Math.max(0, Math.round((nowMs - timestampMs) / 1000))
}

export function formatIssueAge(nowMs: number, timestampMs: number): string {
  const ageSec = getIssueAgeSec(nowMs, timestampMs)
  return ageSec < 5 ? 'just now' : ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`
}

function formatConfirmLatency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

export const IssueCard = memo(function IssueCard({
  advisory,
  occurrenceCount,
  isHeld = false,
  touchFriendly,
  showAlgorithmScores,
  showPeqDetails,
  onDismiss,
}: IssueCardProps) {
  const {
    pitchStr,
    exactFreqStr,
    isClustered,
    velocity,
    isRunaway,
    isWarning,
    isResolved,
    peqNotchSvgPath,
    severityColor,
    copied,
    handleCopy,
    actionsLayout,
  } = useIssueCardState({
    advisory,
    touchFriendly,
  })

  const isInactive = isResolved || isHeld
  const isProvisional = advisory.lifecycle === 'provisional' && !isInactive
  const confirmLatencyMs =
    typeof advisory.confirmLatencyMs === 'number' && Number.isFinite(advisory.confirmLatencyMs)
      ? advisory.confirmLatencyMs
      : null
  const confirmLatencyLabel = !isProvisional && confirmLatencyMs != null ? formatConfirmLatency(confirmLatencyMs) : null
  const nowMs = useTickingNow(!isInactive)
  const ageSec = getIssueAgeSec(nowMs, advisory.timestamp)
  const ageStr = formatIssueAge(nowMs, advisory.timestamp)
  const SeverityIconEl = SEVERITY_ICON[advisory.severity] ?? null
  const isNonCorrectiveWhistle =
    advisory.label === 'WHISTLE' &&
    advisory.severity === 'WHISTLE'
  const shouldShowEq = !isProvisional && !isNonCorrectiveWhistle
  const strategyLabel = isNonCorrectiveWhistle
    ? null
    : getRecommendationStrategyLabel(advisory.advisory?.peq)
  const strategyReason = isNonCorrectiveWhistle ? null : advisory.advisory?.peq?.reason
  const whistleNote = 'Whistle alert only - verify mic and speaker placement first. No EQ cut recommended.'
  const clusterNote = isClustered
    ? `Merged ${advisory.clusterCount} nearby peaks into one broad region. If it keeps returning, check placement or broad EQ before adding more notches.`
    : null

  return (
    <div
      className={`group relative flex flex-col rounded glass-card ${isProvisional ? 'animate-issue-enter-quiet' : SEVERITY_ENTER_CLASS[advisory.severity] ?? 'animate-issue-enter'} overflow-hidden ${
        isInactive
          ? 'border-border/50'
          : isProvisional
            ? 'border-amber-500/25 shadow-none opacity-90'
          : isRunaway
            ? 'border-red-500/70 animate-emergency-glow'
            : isWarning
              ? 'border-amber-500/60 shadow-[0_0_8px_rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.3)] ring-1 ring-amber-500/15'
              : 'border-border/40 hover:border-primary/30'
      }`}
    >
      <div
        className={`absolute left-0 top-0 bottom-0 ${isProvisional ? '' : SEVERITY_STRIP_CLASS[advisory.severity] ?? 'animate-strip-flash'} ${
          isRunaway
            ? 'severity-accent-strip-runaway'
            : advisory.severity === 'GROWING'
              ? 'severity-accent-strip-growing'
              : 'severity-accent-strip'
        }`}
        style={{
          backgroundColor: isInactive
            ? 'var(--muted)'
            : isProvisional
              ? 'rgba(245,158,11,0.45)'
              : severityColor,
          boxShadow: isInactive || isProvisional
            ? 'none'
            : isRunaway
              ? `3px 0 12px -1px ${severityColor}70, 0 0 6px -1px ${severityColor}50`
              : `2px 0 8px -2px ${severityColor}50, 0 0 4px -1px ${severityColor}30`,
        }}
      />

      <div className="flex flex-col relative z-10 @container pl-2.5 pr-1 py-0.5">
        <div className="flex items-baseline gap-1">
          {SeverityIconEl ? (
            <span
              className="flex-shrink-0 inline-flex items-center justify-center self-center"
              style={{
                color: isProvisional ? 'var(--muted-foreground)' : severityColor,
                opacity: isProvisional ? 0.55 : 0.8,
              }}
              role="img"
              aria-label={`Severity: ${getSeverityText(advisory.severity)}`}
              title={getSeverityText(advisory.severity)}
            >
              <SeverityIconEl className="w-3.5 h-3.5" aria-hidden />
            </span>
          ) : null}

          <span
            className={`font-mono font-black leading-none tracking-tight ${
              isRunaway ? 'text-3xl @[320px]:text-4xl' : 'text-2xl @[320px]:text-3xl'
            }`}
            style={{
              fontVariantNumeric: 'tabular-nums slashed-zero',
              color: isInactive || isProvisional ? 'var(--muted-foreground)' : severityColor,
              textShadow: isInactive || isProvisional
                ? 'none'
                : isRunaway
                  ? `0 0 24px ${severityColor}90, 0 0 10px ${severityColor}60, 0 0 3px ${severityColor}40`
                  : isWarning
                    ? `0 0 16px ${severityColor}70, 0 0 6px ${severityColor}40`
                    : `0 0 12px ${severityColor}50, 0 0 4px ${severityColor}30`,
              letterSpacing: '-0.01em',
            }}
          >
            {exactFreqStr}
          </span>

          {pitchStr ? (
            <span className="text-dwa-sm font-mono text-muted-foreground/70 leading-none self-end mb-0.5">
              {pitchStr}
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-0 flex-shrink-0 self-center">
            {isInactive ? (
              <span
                className={badgeClass('info', 'sm')}
                aria-label="Cleared detection retained briefly"
                title="Cleared detection retained briefly"
              >
                cleared
              </span>
            ) : null}
            {isProvisional ? (
              <span
                className={badgeClass('info', 'sm')}
                aria-label="Watching possible feedback"
                title="Watching possible feedback"
              >
                watch
              </span>
            ) : null}
            {confirmLatencyLabel ? (
              <span
                className={badgeClass('info', 'sm')}
                aria-label={`Confirmed in ${confirmLatencyLabel}`}
                title={`Detector confirmed this issue in ${confirmLatencyLabel}`}
              >
                {confirmLatencyLabel}
              </span>
            ) : null}
            {occurrenceCount >= 3 ? (
              <span
                className={badgeClass('warning')}
                aria-label={`Repeat offender: detected ${occurrenceCount} times. Check mic/speaker geometry or broad EQ before adding more notches.`}
                title={`Repeat offender: detected ${occurrenceCount} times.\nCheck mic/speaker geometry or broad EQ before adding more notches.`}
              >
                <TrendingUp className="w-2.5 h-2.5" />
                {occurrenceCount}×
              </span>
            ) : null}
            {isClustered ? (
              <span
                className={badgeClass('info', 'sm')}
                aria-label={clusterNote ?? undefined}
                title={clusterNote ?? `Merged cluster - Q widened. Center: ${exactFreqStr}`}
              >
                {advisory.clusterCount}pk
              </span>
            ) : null}
            {advisory.confidence != null ? (
              <span
                className="inline-flex items-center gap-0 text-dwa-xs font-mono leading-none"
                role="img"
                aria-label={`${Math.round(advisory.confidence * 100)}% confidence`}
                title={`${Math.round(advisory.confidence * 100)}% confidence`}
              >
                <svg width="12" height="12" viewBox="0 0 18 18" className="flex-shrink-0" aria-hidden>
                  <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.06} />
                  <circle
                    cx="9"
                    cy="9"
                    r="7"
                    fill="none"
                    stroke={confidenceColor(advisory.confidence ?? 0)}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={`${advisory.confidence * 44} 44`}
                    transform="rotate(-90 9 9)"
                  />
                </svg>
                <span className={`${
                  advisory.confidence >= 0.85
                    ? 'text-emerald-400/70'
                    : advisory.confidence >= 0.70
                      ? 'text-blue-400/70'
                      : advisory.confidence >= 0.45
                        ? 'text-amber-400/70'
                        : 'text-muted-foreground/40'
                }`}
                >
                  {Math.round(advisory.confidence * 100)}%
                </span>
              </span>
            ) : null}
            {!isInactive ? (
              <span className="text-dwa-xs text-muted-foreground/70 font-mono leading-none">{ageStr}</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1 text-sm font-mono leading-none">
          {advisory.advisory?.peq ? (
            isNonCorrectiveWhistle ? (
              <span
                className="text-dwa-sm font-bold uppercase tracking-[0.16em] text-amber-300/80"
                aria-label={whistleNote}
                title={whistleNote}
              >
                warning only · no EQ cut
              </span>
            ) : shouldShowEq ? (
              <>
                <span
                  style={{ color: severityColor, opacity: 0.8 }}
                  aria-label={strategyReason ? `PEQ cut ${advisory.advisory.peq.gainDb} dB, Q ${Math.round(advisory.advisory.peq.q)}. ${strategyReason}` : undefined}
                  title={strategyReason ?? undefined}
                >
                  <span className="font-bold">{advisory.advisory.peq.gainDb}dB</span> Q:{Math.round(advisory.advisory.peq.q)}
                </span>
                {strategyLabel ? (
                  <span className={`text-dwa-xs uppercase tracking-wide ${
                    advisory.advisory.peq.strategy === 'broad-region'
                      ? 'text-blue-300/70'
                      : 'text-muted-foreground/45'
                  }`}
                    aria-label={strategyReason ? `${strategyLabel}. ${strategyReason}` : strategyLabel}
                    title={strategyReason ?? undefined}
                  >
                    {strategyLabel}
                  </span>
                ) : null}
              </>
            ) : null
          ) : null}
          {velocity > 0 && !isInactive ? (
            <span className={`flex items-center gap-0 ${
              isRunaway ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-muted-foreground/40'
            }`}
            >
              {isRunaway || isWarning ? (
                <AlertTriangle className={`w-2 h-2 flex-shrink-0 ${isRunaway ? 'motion-safe:animate-pulse' : ''}`} />
              ) : null}
              <span>+{velocity.toFixed(0)}dB/s</span>
            </span>
          ) : null}
          {actionsLayout === 'desktop' || actionsLayout === 'copy-only' ? (
            <div className="ml-auto flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
              <IssueCardActions
                advisoryId={advisory.id}
                exactFreqStr={exactFreqStr}
                onDismiss={onDismiss}
                onCopy={handleCopy}
                copied={copied}
                layout={actionsLayout}
              />
            </div>
          ) : null}
        </div>

        {showAlgorithmScores && advisory.algorithmScores ? (
          <div className="text-dwa-xs font-mono text-muted-foreground/70 tracking-wide leading-none">
            {[
              advisory.algorithmScores.msd != null && `MSD:${advisory.algorithmScores.msd.toFixed(2)}`,
              advisory.algorithmScores.phase != null && `PH:${advisory.algorithmScores.phase.toFixed(2)}`,
              advisory.algorithmScores.spectral != null && `SP:${advisory.algorithmScores.spectral.toFixed(2)}`,
              advisory.algorithmScores.comb != null && `CM:${advisory.algorithmScores.comb.toFixed(2)}`,
              advisory.algorithmScores.ihr != null && `IH:${advisory.algorithmScores.ihr.toFixed(2)}`,
              advisory.algorithmScores.ptmr != null && `PT:${advisory.algorithmScores.ptmr.toFixed(2)}`,
            ].filter(Boolean).join('  ')}
            {' -> '}{advisory.algorithmScores.fusedProbability.toFixed(2)}
          </div>
        ) : null}

        {showPeqDetails && advisory.advisory?.peq && peqNotchSvgPath && shouldShowEq ? (
          <div className="flex items-center gap-1.5">
            <svg width="40" height="14" viewBox="0 0 40 14" aria-hidden className="flex-shrink-0">
              <path d={peqNotchSvgPath} fill="none" stroke={severityColor} strokeWidth="1.2" strokeOpacity="0.5" />
            </svg>
            <span className="text-dwa-xs font-mono text-muted-foreground/40 tracking-wide leading-none">
              {advisory.advisory.peq.type} @ {advisory.advisory.peq.hz.toFixed(0)}Hz | Q:{advisory.advisory.peq.q.toFixed(1)} | {advisory.advisory.peq.gainDb}dB
              {advisory.advisory.peq.bandwidthHz != null ? ` | BW:${advisory.advisory.peq.bandwidthHz.toFixed(0)}Hz` : ''}
            </span>
          </div>
        ) : null}

        {actionsLayout === 'mobile' ? (
          <IssueCardActions
            advisoryId={advisory.id}
            exactFreqStr={exactFreqStr}
            onDismiss={onDismiss}
            onCopy={handleCopy}
            copied={copied}
            layout="mobile"
          />
        ) : null}
      </div>

      {!isInactive && !isProvisional ? (
        <div className="h-[3px] w-full relative" aria-hidden title={`Freshness: ${Math.max(0, 60 - ageSec)}s remaining`}>
          <div
            className="absolute inset-0 h-full rounded-full transition-[width,background-color] duration-500 ease-linear"
            style={{
              width: `${Math.max(0, (1 - ageSec / 60)) * 100}%`,
              backgroundColor: `${severityColor}b3`,
            }}
          />
          {ageSec > 20 ? (
            <div
              className="absolute inset-0 h-full rounded-full transition-[width,opacity] duration-500 ease-linear"
              style={{
                width: `${Math.max(0, (1 - ageSec / 60)) * 100}%`,
                backgroundColor: RUNAWAY_COLOR,
                opacity: Math.min(0.55, ((ageSec - 20) / 40) * 0.55),
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
