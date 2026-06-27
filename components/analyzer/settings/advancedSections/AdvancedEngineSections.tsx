'use client'

import { memo } from 'react'
import { ConsoleSlider } from '@/components/ui/console-slider'
import { Section } from '@/components/analyzer/settings/SettingsShared'
import { DEFAULT_DIAGNOSTICS } from '@/lib/settings/defaults'
import { deriveDefaultDetectorSettings } from '@/lib/settings/defaultDetectorSettings'
import { parseFftSize, type AdvancedSectionProps, type DiagnosticsProfile } from './shared'

const expertSelectClass = 'h-7 w-full rounded border border-input bg-transparent px-2 text-dwa-sm font-mono tracking-wide outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

export const AdvancedNoiseFloorSection = memo(function AdvancedNoiseFloorSection({
  settings,
  actions,
}: AdvancedSectionProps) {
  return (
    <Section
      title="Noise Floor"
      color="green"
      showTooltip={settings.showTooltips}
      tooltip="Controls how the adaptive noise floor estimates and tracks ambient noise levels."
    >
      <div className="space-y-1">
        <ConsoleSlider
          label="Attack Time"
          color="green"
          value={`${settings.noiseFloorAttackMs}ms`}
          tooltip={settings.showTooltips ? 'How fast the noise floor rises. 50ms responsive, 1000ms smooth.' : undefined}
          min={50}
          max={1000}
          step={25}
          sliderValue={settings.noiseFloorAttackMs}
          onChange={(value) => actions.updateDiagnosticField('noiseFloorAttackMs', value)}
          defaultValue={DEFAULT_DIAGNOSTICS.noiseFloorAttackMs}
        />
        <ConsoleSlider
          label="Release Time"
          color="green"
          value={`${settings.noiseFloorReleaseMs}ms`}
          tooltip={settings.showTooltips ? 'How fast the noise floor drops. 200ms quick, 5000ms gradual.' : undefined}
          min={200}
          max={5000}
          step={100}
          sliderValue={settings.noiseFloorReleaseMs}
          onChange={(value) => actions.updateDiagnosticField('noiseFloorReleaseMs', value)}
          defaultValue={DEFAULT_DIAGNOSTICS.noiseFloorReleaseMs}
        />
      </div>
    </Section>
  )
})

export const AdvancedPeakDetectionSection = memo(function AdvancedPeakDetectionSection({
  settings,
  actions,
}: AdvancedSectionProps) {
  const modeDefaults = deriveDefaultDetectorSettings(settings.mode)

  return (
    <Section
      title="Peak Detection"
      color="blue"
      showTooltip={settings.showTooltips}
      tooltip="Fine-tune peak merging, threshold modes, and minimum prominence for peak identification."
    >
      <div className="space-y-1">
        <ConsoleSlider
          label="Peak Merge"
          color="blue"
          value={`${settings.peakMergeCents}c`}
          tooltip={settings.showTooltips ? 'Merge peaks within this cents window. 10c precise, 150c wide.' : undefined}
          min={10}
          max={150}
          step={5}
          sliderValue={settings.peakMergeCents}
          onChange={(value) => actions.updateDiagnosticField('peakMergeCents', value)}
          defaultValue={DEFAULT_DIAGNOSTICS.peakMergeCents}
        />
        <Section
          title="Threshold Mode"
          color="blue"
          showTooltip={settings.showTooltips}
          tooltip="Absolute: fixed dB threshold. Relative: above noise floor. Hybrid: uses both (recommended)."
        >
          <select
            className={expertSelectClass}
            value={settings.thresholdMode}
            onChange={(event) => actions.updateDiagnosticField('thresholdMode', event.currentTarget.value as DiagnosticsProfile['thresholdMode'])}
          >
            <option value="absolute">Absolute - Fixed dB</option>
            <option value="relative">Relative - Above Noise</option>
            <option value="hybrid">Hybrid (Recommended)</option>
          </select>
        </Section>
        <ConsoleSlider
          label="Prominence"
          color="blue"
          value={`${settings.prominenceDb}dB`}
          tooltip={settings.showTooltips ? 'Minimum peak prominence. 4dB sensitive, 30dB strong peaks only.' : undefined}
          min={4}
          max={30}
          step={1}
          sliderValue={settings.prominenceDb}
          onChange={(value) => actions.updateDiagnosticField('prominenceDbOverride', value)}
          defaultValue={modeDefaults.prominenceDb}
          onResetToDefault={() => actions.updateDiagnosticField('prominenceDbOverride', undefined)}
        />
      </div>
    </Section>
  )
})

export const AdvancedTrackManagementSection = memo(function AdvancedTrackManagementSection({
  settings,
  actions,
}: AdvancedSectionProps) {
  const modeDefaults = deriveDefaultDetectorSettings(settings.mode)

  return (
    <Section
      title="Track Management"
      color="green"
      showTooltip={settings.showTooltips}
      tooltip="Controls for frequency tracker limits, timeout, and harmonic association tolerance."
    >
      <div className="space-y-1">
        <ConsoleSlider
          label="Max Tracks"
          color="green"
          value={`${settings.maxTracks}`}
          tooltip={settings.showTooltips ? 'Maximum simultaneous frequency tracks. 8 minimal, 128 maximum.' : undefined}
          min={8}
          max={128}
          step={8}
          sliderValue={settings.maxTracks}
          onChange={(value) => actions.updateDiagnosticField('maxTracks', value)}
          defaultValue={DEFAULT_DIAGNOSTICS.maxTracks}
        />
        <ConsoleSlider
          label="Track Timeout"
          color="green"
          value={`${settings.trackTimeoutMs}ms`}
          tooltip={settings.showTooltips ? 'How long a quiet track persists before removal. 200ms fast, 5000ms persistent.' : undefined}
          min={200}
          max={5000}
          step={100}
          sliderValue={settings.trackTimeoutMs}
          onChange={(value) => actions.updateDiagnosticField('trackTimeoutMs', value)}
          defaultValue={modeDefaults.trackTimeoutMs}
          onResetToDefault={() => actions.updateDiagnosticField('trackTimeoutMs', 'mode-default')}
        />
        <ConsoleSlider
          label="Harmonic Tolerance"
          color="blue"
          value={`${settings.harmonicToleranceCents}c`}
          tooltip={settings.showTooltips ? 'Cents tolerance for harmonic association. 25c tight, 400c loose.' : undefined}
          min={25}
          max={400}
          step={25}
          sliderValue={settings.harmonicToleranceCents}
          onChange={(value) => actions.updateDiagnosticField('harmonicToleranceCents', value)}
          defaultValue={DEFAULT_DIAGNOSTICS.harmonicToleranceCents}
        />
      </div>
    </Section>
  )
})

export const AdvancedDspSection = memo(function AdvancedDspSection({
  settings,
  actions,
}: AdvancedSectionProps) {
  const modeDefaults = deriveDefaultDetectorSettings(settings.mode)

  return (
    <Section
      title="DSP"
      color="blue"
      showTooltip={settings.showTooltips}
      tooltip="FFT resolution, spectral smoothing, and frequency analysis parameters."
    >
      <div className="space-y-1">
        <Section
          title="FFT Size"
          color="blue"
          showTooltip={settings.showTooltips}
          tooltip="4096 fast, 8192 balanced, 16384 high-res low-end."
        >
          <select
            className={expertSelectClass}
            value={settings.fftSize.toString()}
            onChange={(event) => actions.updateDiagnosticField('fftSizeOverride', parseFftSize(event.currentTarget.value))}
          >
            <option value="4096">4096 - Fast</option>
            <option value="8192">8192 - Balanced</option>
            <option value="16384">16384 - High Res</option>
          </select>
        </Section>
        <ConsoleSlider
          label="Smoothing"
          color="blue"
          value={`${(settings.smoothingTimeConstant * 100).toFixed(0)}%`}
          tooltip={settings.showTooltips ? 'Spectral smoothing time constant. 0% raw, 95% very smooth.' : undefined}
          min={0}
          max={0.95}
          step={0.05}
          sliderValue={settings.smoothingTimeConstant}
          onChange={(value) => actions.updateDiagnosticField('smoothingTimeConstantOverride', value)}
          defaultValue={modeDefaults.smoothingTimeConstant}
          onResetToDefault={() => actions.updateDiagnosticField('smoothingTimeConstantOverride', undefined)}
        />
      </div>
    </Section>
  )
})
