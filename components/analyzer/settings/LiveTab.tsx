'use client'

import { memo, useCallback } from 'react'
import { Slider } from '@/components/ui/slider'
import { ConsoleSlider } from '@/components/ui/console-slider'
import { useSettings } from '@/contexts/SettingsContext'
import type { DetectorSettings } from '@/types/advisory'
import { FREQ_RANGE_PRESETS } from '@/lib/dsp/constants'
import { formatFreqLabel } from '@/lib/utils/pitchUtils'
import { roundFreqToNice } from '@/lib/utils/mathHelpers'
import { MODE_BASELINES } from '@/lib/settings/modeBaselines'
import { FRESH_START_SENSITIVITY_OFFSET_DB } from '@/lib/settings/defaults'
import type { ModeId } from '@/types/settings'

// ── Constants ────────────────────────────────────────────────────────────────

const LOG_MIN = Math.log10(20)
const LOG_MAX = Math.log10(20000)
const LIVE_MODES: Array<{ id: ModeId; label: string }> = [
  { id: 'speech', label: 'Speech' },
  { id: 'worship', label: 'Worship' },
  { id: 'liveMusic', label: 'Live' },
  { id: 'theater', label: 'Theater' },
  { id: 'monitors', label: 'Monitors' },
  { id: 'broadcast', label: 'Bcast' },
  { id: 'outdoor', label: 'Outdoor' },
]

// ── Props ────────────────────────────────────────────────────────────────────

interface LiveTabProps {
  settings: DetectorSettings
}

// ── LiveTab ──────────────────────────────────────────────────────────────────
// Show-time controls only: sensitivity + frequency range.
// No accordions — everything always visible, fast and obvious.

export const LiveTab = memo(function LiveTab({ settings }: LiveTabProps) {
  const ctx = useSettings()

  /** Sensitivity slider writes absolute dB; compute delta for layered model */
  const defaultSensitivityOffsetDb =
    ctx.session.modeId === 'speech' ? FRESH_START_SENSITIVITY_OFFSET_DB : 0
  const defaultSensitivityDb =
    MODE_BASELINES[ctx.session.modeId].feedbackThresholdDb +
    defaultSensitivityOffsetDb
  const defaultSensitivitySliderValue = 52 - defaultSensitivityDb

  const handleSensitivityChange = useCallback((v: number) => {
    const absoluteDb = 52 - v
    const baseline = MODE_BASELINES[ctx.session.modeId]
    const currentEffective = baseline.feedbackThresholdDb + ctx.session.liveOverrides.sensitivityOffsetDb
    const delta = absoluteDb - currentEffective
    if (delta !== 0) {
      ctx.setSensitivityOffset(ctx.session.liveOverrides.sensitivityOffsetDb + delta)
    }
  }, [ctx])

  const handleSensitivityReset = useCallback(() => {
    if (ctx.session.liveOverrides.sensitivityOffsetDb !== defaultSensitivityOffsetDb) {
      ctx.setSensitivityOffset(defaultSensitivityOffsetDb)
    }
  }, [ctx, defaultSensitivityOffsetDb])

  const handleFreqSliderChange = useCallback(([logMin, logMax]: number[]) => {
    const newMin = roundFreqToNice(Math.pow(10, logMin))
    const newMax = roundFreqToNice(Math.pow(10, logMax))
    ctx.setFocusRange({ kind: 'custom', minHz: newMin, maxHz: newMax })
  }, [ctx])

  const handleFreqPresetClick = useCallback((minFrequency: number, maxFrequency: number) => {
    ctx.setFocusRange({ kind: 'custom', minHz: minFrequency, maxHz: maxFrequency })
  }, [ctx])

  return (
    <div className="space-y-1">
      <div className="space-y-0.5">
        <span className="section-label text-muted-foreground">Mode</span>
        <div className="grid grid-cols-3 @sm:grid-cols-4 gap-0.5">
          {LIVE_MODES.map((mode) => (
            <button type="button"
              key={mode.id}
              onClick={() => ctx.setMode(mode.id)}
              className={`flex min-h-8 md:min-h-7 items-center justify-center overflow-hidden cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 px-1 rounded text-xs font-mono font-bold tracking-wide transition-[color,background-color,border-color,box-shadow] ${
                settings.mode === mode.id
                  ? 'bg-[var(--console-amber)]/10 text-[var(--console-amber)] border border-[var(--console-amber)]/40 btn-glow'
                  : 'text-muted-foreground hover:text-foreground border border-transparent hover:border-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.18)]'
              }`}
            >
              <span className="truncate">{mode.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-0.5">
        <span className="section-label text-muted-foreground">EQ Action Style</span>
        <div className="flex items-center gap-0.5">
          {([['surgical', 'Surgical'], ['heavy', 'Heavy']] as const).map(([style, label]) => (
            <button type="button"
              key={style}
              onClick={() => ctx.setEqStyle(style)}
              className={`min-h-8 md:min-h-7 flex-1 px-2 rounded text-xs font-mono font-bold tracking-wide transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                settings.eqPreset === style
                  ? 'bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.12)] text-[var(--console-amber)] border border-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.38)]'
                  : 'text-muted-foreground hover:text-foreground border border-transparent hover:border-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.18)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Sensitivity slider */}
      <ConsoleSlider
        label="Sensitivity"
        value={`${settings.feedbackThresholdDb}dB`}
        tooltip={settings.showTooltips ? 'Fader up = picks up more. Lower = catches subtle resonances. Higher = fewer wrong detections. Also draggable on the RTA spectrum.' : undefined}
        showTooltip={settings.showTooltips}
        min={2} max={50} step={1}
        sliderValue={52 - settings.feedbackThresholdDb}
        onChange={handleSensitivityChange}
        defaultValue={defaultSensitivitySliderValue}
        defaultLabel={`Reset to default (${defaultSensitivityDb}dB)`}
        onResetToDefault={handleSensitivityReset}
      />

      {/* Section divider */}
      <div className="panel-groove-subtle" />

      {/* Frequency range presets + slider */}
      <div className="space-y-0.5">
        <div className="grid grid-cols-4 gap-0.5">
          {FREQ_RANGE_PRESETS.map((preset) => {
            const isActive = settings.minFrequency === preset.minFrequency && settings.maxFrequency === preset.maxFrequency
            return (
              <button type="button" key={preset.label} onClick={() => handleFreqPresetClick(preset.minFrequency, preset.maxFrequency)}
                className={`min-h-8 px-1 py-0.5 rounded flex flex-col items-center gap-0.5 text-xs font-mono font-bold tracking-wide transition-[color,background-color,border-color,box-shadow] cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                  isActive
                    ? 'bg-[rgba(75,146,255,0.12)] text-[var(--console-blue)] border border-[rgba(75,146,255,0.38)] shadow-[0_0_10px_rgba(75,146,255,0.16)]'
                    : 'bg-[rgba(255,255,255,0.03)] text-foreground/50 border border-[rgba(255,255,255,0.08)] hover:text-foreground/80 hover:border-border/50'
                }`}
              >
                {preset.label}
                <span className={`text-dwa-xs font-normal block ${isActive ? 'text-[rgba(75,146,255,0.65)]' : 'text-muted-foreground/50'}`}>{preset.shortRange}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between">
          <span className="section-label" style={{ color: 'var(--console-blue)' }}>Freq Range</span>
          <span className="font-mono text-[13px] font-semibold tabular-nums" style={{ color: 'var(--console-blue)' }}>{formatFreqLabel(settings.minFrequency)} – {formatFreqLabel(settings.maxFrequency)}</span>
        </div>
        <Slider value={[Math.log10(Math.max(20, settings.minFrequency)), Math.log10(Math.min(20000, settings.maxFrequency))]} onValueChange={handleFreqSliderChange} min={LOG_MIN} max={LOG_MAX} step={0.005} minStepsBetweenThumbs={0.1} />
      </div>

    </div>
  )
})
