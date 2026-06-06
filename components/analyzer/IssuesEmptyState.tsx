'use client'

import { memo } from 'react'
import { DwaLogo } from './DwaLogo'
import { useSettings } from '@/contexts/SettingsContext'
import { formatFreqLabel } from '@/lib/utils/pitchUtils'
import type { SpectrumStatus } from '@/hooks/audioAnalyzerTypes'

interface IssuesEmptyStateProps {
  isRunning?: boolean
  isLowSignal?: boolean
  spectrumStatus?: SpectrumStatus | null
  noiseFloorDb?: number | null
  onStart?: () => void
}

function formatStatusDb(value: number): string {
  return `${Math.round(value)}dB`
}

function formatLatencyMs(value: number): string {
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatReportGateLabel(gate: SpectrumStatus['lastReportGate']): string | null {
  switch (gate) {
    case 'not-eligible': return 'Not Eligible'
    case 'steady-chromatic-tone': return 'Chromatic Gate'
    case 'growing-waiting-persistence': return 'Persistence Wait'
    case 'speech-formant': return 'Formant Gate'
    case 'fusion-uncertain': return 'Fusion Wait'
    case 'fusion-not-feedback': return 'Not Feedback'
    case 'speech-material': return 'Speech Material'
    case 'music-material': return 'Music Material'
    case 'low-confidence': return 'Low Confidence'
    case 'whistle-ignored': return 'Whistle Filter'
    case 'mode-filter': return 'Mode Filter'
    case 'reported': return 'Report Ready'
    default: return null
  }
}

function formatFusionVerdict(value: SpectrumStatus['lastFusionVerdict']): string | null {
  switch (value) {
    case 'POSSIBLE_FEEDBACK': return 'possible'
    case 'NOT_FEEDBACK': return 'not'
    case 'UNCERTAIN': return 'uncertain'
    case 'FEEDBACK': return 'feedback'
    default: return null
  }
}

function getAnalyzerStatusLabel(
  spectrumStatus: SpectrumStatus | null | undefined,
  noiseFloorDb: number | null | undefined,
): string | null {
  if (!spectrumStatus) return null

  if (spectrumStatus.isSignalPresent === false) return 'Signal Gate'
  if (spectrumStatus.lastReportDecision === 'blocked') {
    const gateLabel = formatReportGateLabel(spectrumStatus.lastReportGate)
    if (gateLabel) return gateLabel
  }
  if (spectrumStatus.contentType === 'compressed' || spectrumStatus.isCompressed) return 'Compression Guard'
  if (spectrumStatus.contentType === 'music') return 'Music Guard'
  if (noiseFloorDb == null) return 'Measuring Floor'

  if (
    Number.isFinite(spectrumStatus.peak) &&
    Number.isFinite(spectrumStatus.effectiveThresholdDb) &&
    spectrumStatus.peak < (spectrumStatus.effectiveThresholdDb ?? -Infinity)
  ) {
    return 'Below Threshold'
  }

  return 'Listening'
}

function buildAnalyzerStatusMetrics(spectrumStatus: SpectrumStatus | null | undefined): string[] {
  if (!spectrumStatus) return []

  const metrics: string[] = []
  if (Number.isFinite(spectrumStatus.peak)) {
    metrics.push(`pk ${formatStatusDb(spectrumStatus.peak)}`)
  }
  if (Number.isFinite(spectrumStatus.effectiveThresholdDb)) {
    metrics.push(`thr ${formatStatusDb(spectrumStatus.effectiveThresholdDb ?? 0)}`)
  }
  if (Number.isFinite(spectrumStatus.lastConfirmLatencyMs)) {
    metrics.push(`last ${formatLatencyMs(spectrumStatus.lastConfirmLatencyMs ?? 0)}`)
  }
  const fusionVerdict = formatFusionVerdict(spectrumStatus.lastFusionVerdict)
  if (fusionVerdict) {
    metrics.push(`fusion ${fusionVerdict}`)
  }
  if (Number.isFinite(spectrumStatus.lastFeedbackProbability)) {
    metrics.push(`prob ${formatPercent(spectrumStatus.lastFeedbackProbability ?? 0)}`)
  }
  if (Number.isFinite(spectrumStatus.lastFusionConfidence)) {
    metrics.push(`conf ${formatPercent(spectrumStatus.lastFusionConfidence ?? 0)}`)
  }
  return metrics
}

export const IssuesEmptyState = memo(function IssuesEmptyState({
  isRunning = false,
  isLowSignal = false,
  spectrumStatus,
  noiseFloorDb,
  onStart,
}: IssuesEmptyStateProps) {
  const { settings } = useSettings()
  const analyzerStatusLabel = getAnalyzerStatusLabel(spectrumStatus, noiseFloorDb)
  const analyzerStatusMetrics = buildAnalyzerStatusMetrics(spectrumStatus)

  if (!isRunning && onStart) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-[120px] py-6 gap-3">
        <span className="flex items-center gap-1.5 font-mono text-dwa-sm font-bold tracking-[0.3em] uppercase text-[var(--console-amber)]/70 mb-1">
          <span
            className="inline-block w-1 h-1 rounded-full bg-[var(--console-amber)]/70 animate-led-pulse-amber flex-shrink-0"
            aria-hidden
          />
          Standby
        </span>

        <button type="button"
          onClick={onStart}
          aria-label="Start analysis"
          className="group relative flex flex-col items-center justify-center gap-3 w-full max-w-[220px] py-5 px-5 rounded-xl border border-primary/20 hover:border-primary/40 bg-primary/5 hover:bg-primary/10 active:scale-[0.97] transition-[box-shadow,transform] duration-300 cursor-pointer animate-start-glow focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary"
          style={{
            background:
              'radial-gradient(ellipse 100% 80% at 50% 60%, rgba(75, 146, 255, 0.14) 0%, rgba(75, 146, 255, 0.04) 55%, transparent 100%)',
          }}
        >

          <div
            className="relative flex items-center justify-center overflow-hidden rounded-full"
            style={{ width: 80, height: 80 }}
          >
            <div className="standby-glow-ring" />
            <div className="standby-glow-ring" style={{ animationDelay: '1.75s' }} />
            <div className="standby-sweep" aria-hidden />
            <DwaLogo className="relative z-10 w-20 h-20 text-foreground drop-shadow-[0_0_12px_var(--console-blue-glow)]" />
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <span className="font-mono text-xs font-bold tracking-[0.15em] uppercase text-muted-foreground group-hover:text-foreground transition-colors">
              Start Analysis
            </span>
            <span className="hidden tablet:block font-mono text-dwa-xs text-muted-foreground/30 mt-1">
              Enter
            </span>
          </div>
        </button>

        <div className="flex flex-col items-center gap-1 mt-3 max-w-[220px]">
          <div className="flex items-center gap-2 font-mono text-dwa-xs tracking-[0.12em] uppercase text-muted-foreground/65">
            <span>{settings.mode}</span>
            <span className="text-muted-foreground/25">.</span>
            <span>{settings.fftSize} FFT</span>
            <span className="text-muted-foreground/25">.</span>
            <span>
              {formatFreqLabel(settings.minFrequency)}-{formatFreqLabel(settings.maxFrequency)}
            </span>
          </div>
          <p className="text-dwa-sm font-mono text-muted-foreground/40 text-center">
            Adjust sensitivity with the fader or drag the threshold line on the spectrum
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col items-center justify-start flex-1 min-h-[80px] pt-10 gap-2">
      <div
        className="absolute inset-0 flex flex-col items-center justify-start pt-10 gap-2 transition-opacity duration-[2000ms] ease-in-out"
        style={{ opacity: isLowSignal ? 1 : 0, pointerEvents: isLowSignal ? 'auto' : 'none' }}
        aria-hidden={!isLowSignal}
      >
        <div
          className="relative flex items-center justify-center flex-shrink-0"
          style={{ width: 44, height: 44 }}
        >
          <div className="radar-ring" style={{ animationPlayState: isLowSignal ? 'running' : 'paused' }} />
          <div className="radar-ring" style={{ animationDelay: '1.4s', animationPlayState: isLowSignal ? 'running' : 'paused' }} />
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-[var(--console-blue)]/50" />
        </div>
        <div className="font-mono text-dwa-sm font-bold tracking-[0.25em] uppercase text-[var(--console-blue)]/70">
          Low Signal
        </div>
        <div className="flex items-center gap-1.5 motion-safe:animate-pulse">
          <span className="text-[var(--console-blue)]/60 text-xs leading-none">▲</span>
          <span className="font-mono text-dwa-xs text-[var(--console-blue)]/50 tracking-wider uppercase">
            Increase gain
          </span>
        </div>
      </div>

      <div
        className="absolute inset-0 flex flex-col items-center justify-start pt-10 gap-2 transition-opacity duration-[2000ms] ease-in-out"
        style={{ opacity: isLowSignal ? 0 : 1, pointerEvents: isLowSignal ? 'none' : 'auto' }}
        aria-hidden={isLowSignal}
      >
        <div
          className="relative flex items-center justify-center flex-shrink-0"
          style={{ width: 56, height: 56 }}
        >
          <div className="radar-ring-green" style={{ animationPlayState: isLowSignal ? 'paused' : 'running' }} />
          <div className="radar-ring-green" style={{ animationDelay: '1.75s', animationPlayState: isLowSignal ? 'paused' : 'running' }} />
          <div
            className="w-3 h-3 rounded-full flex-shrink-0 bg-emerald-500/60"
            style={{ boxShadow: '0 0 10px var(--console-green-glow)' }}
          />
        </div>
        <div className="font-mono text-dwa-sm font-bold tracking-[0.2em] uppercase text-emerald-500/80">
          All Clear
        </div>
        {analyzerStatusLabel ? (
          <div className="flex max-w-[260px] flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-dwa-xs uppercase tracking-[0.12em] text-muted-foreground/55">
            <span className="text-emerald-400/75">{analyzerStatusLabel}</span>
            {analyzerStatusMetrics.map((metric) => (
              <span key={metric} className="text-muted-foreground/40">
                {metric}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
})
