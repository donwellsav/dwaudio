'use client'

import { memo, useCallback, type CSSProperties } from 'react'
import { ChevronDown, Mic } from 'lucide-react'
import { ConsoleSlider } from '@/components/ui/console-slider'
import { useEngine } from '@/contexts/EngineContext'
import { useSettings } from '@/contexts/SettingsContext'
import type { DetectorSettings } from '@/types/advisory'
import { FREQ_RANGE_PRESETS } from '@/lib/dsp/constants'
import { formatFreqLabel } from '@/lib/utils/pitchUtils'
import { clamp, roundFreqToNice } from '@/lib/utils/mathHelpers'
import { MODE_BASELINES } from '@/lib/settings/modeBaselines'
import { FRESH_START_SENSITIVITY_OFFSET_DB } from '@/lib/settings/defaults'
import type { ModeId } from '@/types/settings'

// ── Constants ────────────────────────────────────────────────────────────────

const LOG_MIN = Math.log10(20)
const LOG_MAX = Math.log10(20000)
const FREQ_LOG_STEP = 0.005
const FREQ_LOG_MIN_GAP = 0.1
const LIVE_MODES: Array<{ id: ModeId; label: string }> = [
  { id: 'speech', label: 'Speech' },
  { id: 'worship', label: 'Worship' },
  { id: 'liveMusic', label: 'Live' },
  { id: 'theater', label: 'Theater' },
  { id: 'monitors', label: 'Monitors' },
  { id: 'broadcast', label: 'Bcast' },
  { id: 'outdoor', label: 'Outdoor' },
]

function getBlueRangeStyle(percent: number): CSSProperties {
  return {
    '--console-range-start': 'rgba(75,146,255,0.28)',
    '--console-range-end': 'rgba(75,146,255,0.65)',
    '--console-range-percent': `${clamp(percent, 0, 100)}%`,
    '--console-range-glow': '0 0 6px var(--console-blue-glow)',
    '--console-thumb-border': 'var(--console-blue)',
    '--console-thumb-glow': '0 0 8px var(--console-blue-glow), 0 0 2px var(--console-blue-glow)',
  } as CSSProperties
}

// ── Props ────────────────────────────────────────────────────────────────────

interface LiveTabProps {
  settings: DetectorSettings
}

// ── LiveTab ──────────────────────────────────────────────────────────────────
// Show-time controls only: sensitivity + frequency range.
// No accordions — everything always visible, fast and obvious.

export const LiveTab = memo(function LiveTab({ settings }: LiveTabProps) {
  const ctx = useSettings()
  const { devices, selectedDeviceId, handleDeviceChange } = useEngine()
  const selectedDeviceLabel = selectedDeviceId
    ? devices.find((device) => device.deviceId === selectedDeviceId)?.label ?? 'Default (System)'
    : 'Default (System)'

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

  const freqLogMin = clamp(Math.log10(Math.max(20, settings.minFrequency)), LOG_MIN, LOG_MAX - FREQ_LOG_MIN_GAP)
  const freqLogMax = clamp(Math.log10(Math.min(20000, settings.maxFrequency)), freqLogMin + FREQ_LOG_MIN_GAP, LOG_MAX)
  const freqMinPercent = ((freqLogMin - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100
  const freqMaxPercent = ((freqLogMax - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100

  const handleFreqRangeChange = useCallback((logMin: number, logMax: number) => {
    const boundedMin = clamp(logMin, LOG_MIN, LOG_MAX - FREQ_LOG_MIN_GAP)
    const boundedMax = clamp(logMax, boundedMin + FREQ_LOG_MIN_GAP, LOG_MAX)
    const newMin = roundFreqToNice(Math.pow(10, boundedMin))
    const newMax = roundFreqToNice(Math.pow(10, boundedMax))
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
        <div className="space-y-1" aria-label="Frequency range controls">
          <label className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
            <span className="section-label text-muted-foreground">Min</span>
            <input
              type="range"
              aria-label="Minimum frequency"
              min={LOG_MIN}
              max={freqLogMax - FREQ_LOG_MIN_GAP}
              step={FREQ_LOG_STEP}
              value={freqLogMin}
              onChange={(event) => handleFreqRangeChange(Number(event.currentTarget.value), freqLogMax)}
              className="console-native-range h-4 w-full"
              style={getBlueRangeStyle(freqMinPercent)}
            />
          </label>
          <label className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
            <span className="section-label text-muted-foreground">Max</span>
            <input
              type="range"
              aria-label="Maximum frequency"
              min={freqLogMin + FREQ_LOG_MIN_GAP}
              max={LOG_MAX}
              step={FREQ_LOG_STEP}
              value={freqLogMax}
              onChange={(event) => handleFreqRangeChange(freqLogMin, Number(event.currentTarget.value))}
              className="console-native-range h-4 w-full"
              style={getBlueRangeStyle(freqMaxPercent)}
            />
          </label>
        </div>
      </div>

      <div className="panel-groove-subtle" />

      <label className="block space-y-0.5">
        <span className="section-label text-muted-foreground">Audio Input</span>
        <div className="relative">
          <select
            aria-label="Select audio input"
            title={`Audio input: ${selectedDeviceLabel}`}
            value={selectedDeviceId}
            onChange={(event) => handleDeviceChange(event.currentTarget.value)}
            className="console-input h-8 w-full cursor-pointer appearance-none rounded bg-transparent pl-8 pr-7 font-mono text-dwa-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-primary"
          >
            <option value="" className="text-foreground">Default (System)</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId} className="text-foreground">
                {device.label}
              </option>
            ))}
          </select>
          <Mic className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
        </div>
      </label>

    </div>
  )
})
