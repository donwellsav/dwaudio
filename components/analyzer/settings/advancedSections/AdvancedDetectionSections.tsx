'use client'

import { memo } from 'react'
import { ConsoleSlider } from '@/components/ui/console-slider'
import { LEDToggle } from '@/components/ui/led-toggle'
import { Section } from '@/components/analyzer/settings/SettingsShared'
import { deriveDefaultDetectorSettings } from '@/lib/settings/defaultDetectorSettings'
import { AVAILABLE_ALGORITHMS, type AdvancedSectionProps } from './shared'

export const AdvancedDetectionPolicySection = memo(function AdvancedDetectionPolicySection({
  settings,
  actions,
}: AdvancedSectionProps) {
  const modeDefaults = deriveDefaultDetectorSettings(settings.mode)

  return (
    <Section
      title="Detection Policy"
      color="amber"
      showTooltip={settings.showTooltips}
      tooltip="Expert tuning for detection thresholds, timing, and filtering. Changes affect detection accuracy across all modes."
    >
      <div className="space-y-1">
        <ConsoleSlider
          label="Ring"
          color="amber"
          value={`${settings.ringThresholdDb}dB`}
          tooltip={settings.showTooltips ? 'Resonance detection. 2-3 dB monitor tuning, 4-5 dB normal, 6+ dB live music/outdoor.' : undefined}
          min={1}
          max={12}
          step={0.5}
          sliderValue={settings.ringThresholdDb}
          onChange={(value) => actions.updateDiagnosticField('ringThresholdDbOverride', value)}
          defaultValue={modeDefaults.ringThresholdDb}
          onResetToDefault={() => actions.updateDiagnosticField('ringThresholdDbOverride', undefined)}
        />
        <ConsoleSlider
          label="Growth"
          color="amber"
          value={`${settings.growthRateThreshold.toFixed(1)}dB/s`}
          tooltip={settings.showTooltips ? 'How fast feedback must grow. 0.5-1dB/s catches early, 3+dB/s only runaway.' : undefined}
          min={0.5}
          max={8}
          step={0.5}
          sliderValue={settings.growthRateThreshold}
          onChange={(value) => actions.updateDiagnosticField('growthRateThresholdOverride', value)}
          defaultValue={modeDefaults.growthRateThreshold}
          onResetToDefault={() => actions.updateDiagnosticField('growthRateThresholdOverride', undefined)}
        />
        <ConsoleSlider
          label="Confidence"
          color="amber"
          value={`${Math.round((settings.confidenceThreshold ?? 0.35) * 100)}%`}
          tooltip={settings.showTooltips ? 'Minimum confidence to flag. 25-35% aggressive, 45-55% balanced, 60%+ conservative.' : undefined}
          min={0.2}
          max={0.8}
          step={0.05}
          sliderValue={settings.confidenceThreshold ?? 0.35}
          onChange={(value) => actions.updateDiagnosticField('confidenceThresholdOverride', value)}
          defaultValue={modeDefaults.confidenceThreshold}
          onResetToDefault={() => actions.updateDiagnosticField('confidenceThresholdOverride', undefined)}
        />
        <LEDToggle
          color="amber"
          checked={settings.aWeightingEnabled}
          onChange={(checked) => actions.updateDiagnosticField('aWeightingOverride', checked)}
          label="A-Weighting (IEC 61672-1)"
          tooltip={settings.showTooltips ? 'Apply IEC 61672-1 A-weighting curve. Emphasizes 1-5 kHz where hearing is most sensitive.' : undefined}
        />
        <LEDToggle
          color="amber"
          checked={settings.ignoreWhistle}
          onChange={(checked) => actions.updateDiagnosticField('ignoreWhistleOverride', checked)}
          label="Ignore Whistle"
          tooltip={settings.showTooltips ? 'Suppress alerts from deliberate whistling or single-tone test signals.' : undefined}
        />
      </div>
    </Section>
  )
})

export const AdvancedTimingSection = memo(function AdvancedTimingSection({
  settings,
  actions,
}: AdvancedSectionProps) {
  const modeDefaults = deriveDefaultDetectorSettings(settings.mode)

  return (
    <Section
      title="Timing"
      color="blue"
      showTooltip={settings.showTooltips}
      tooltip="Controls how long peaks must persist before flagging and how fast resolved issues disappear."
    >
      <div className="space-y-1">
        <ConsoleSlider
          label="Sustain Time"
          color="blue"
          value={`${settings.sustainMs}ms`}
          tooltip={settings.showTooltips ? 'How long a peak must persist before flagging. 100ms fast, 2000ms cautious.' : undefined}
          min={100}
          max={2000}
          step={50}
          sliderValue={settings.sustainMs}
          onChange={(value) => actions.updateDiagnosticField('sustainMsOverride', value)}
          defaultValue={modeDefaults.sustainMs}
          onResetToDefault={() => actions.updateDiagnosticField('sustainMsOverride', undefined)}
        />
        <ConsoleSlider
          label="Clear Time"
          color="blue"
          value={`${settings.clearMs}ms`}
          tooltip={settings.showTooltips ? 'How fast resolved issues disappear. 100ms quick, 2000ms persistent.' : undefined}
          min={100}
          max={2000}
          step={50}
          sliderValue={settings.clearMs}
          onChange={(value) => actions.updateDiagnosticField('clearMsOverride', value)}
          defaultValue={modeDefaults.clearMs}
          onResetToDefault={() => actions.updateDiagnosticField('clearMsOverride', undefined)}
        />
      </div>
    </Section>
  )
})

export const AdvancedAlgorithmsSection = memo(function AdvancedAlgorithmsSection({
  settings,
  actions,
}: AdvancedSectionProps) {
  return (
    <Section
      title="Algorithms"
      color="amber"
      showTooltip={settings.showTooltips}
      tooltip="Deterministic algorithm selection for detection fusion. Auto mode uses all six algorithms with content-adaptive weights."
    >
      <div className="space-y-1">
        <LEDToggle
          color="amber"
          checked={settings.adaptivePhaseSkip}
          onChange={(checked) => actions.updateDiagnosticField('adaptivePhaseSkip', checked)}
          label="Adaptive Phase Skip"
          tooltip={settings.showTooltips ? 'Skip phase FFT when MSD is decisive. Saves CPU in speech/monitor modes. Always runs full phase in music/worship.' : undefined}
        />
        <div className="space-y-1">
          <button
            onClick={actions.toggleAlgorithmMode}
            className={`min-h-8 md:min-h-7 cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 w-full px-1.5 rounded text-xs font-mono font-bold tracking-wide transition-colors ${
              settings.algorithmMode === 'auto'
                ? 'bg-[var(--console-amber)]/15 text-[var(--console-amber)] border border-[var(--console-amber)]/35'
                : 'text-muted-foreground hover:text-foreground border border-transparent hover:border-border'
            }`}
          >
            Auto
          </button>
          <div className={`grid grid-cols-3 gap-1 ${settings.algorithmMode === 'auto' ? 'pointer-events-none' : ''}`}>
            {AVAILABLE_ALGORITHMS.map(([key, label]) => {
              const isAuto = settings.algorithmMode === 'auto'
              const enabled = isAuto || (settings.enabledAlgorithms?.includes(key) ?? true)

              return (
                <button
                  key={key}
                  onClick={() => actions.toggleAlgorithm(key)}
                  className={`min-h-8 md:min-h-7 cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 px-1 rounded text-xs font-mono font-bold text-center transition-colors ${
                    isAuto
                      ? 'text-[var(--console-amber)]/50 border border-[var(--console-amber)]/20 bg-transparent'
                      : enabled
                        ? 'bg-[var(--console-amber)]/15 text-[var(--console-amber)] border border-[var(--console-amber)]/35'
                        : 'text-muted-foreground hover:text-foreground border border-transparent hover:border-border'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Section>
  )
})
