'use client'

import { memo } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { ConsoleSlider } from '@/components/ui/console-slider'
import { LEDToggle } from '@/components/ui/led-toggle'
import { DEFAULT_DISPLAY_PREFS } from '@/lib/settings/defaults'
import { useAdvancedTabState } from '@/hooks/useAdvancedTabState'
import type { DetectorSettings } from '@/types/advisory'
import { Section, SettingsGrid } from './SettingsShared'

export interface DisplayTabProps {
  settings: DetectorSettings
}

export const DisplayTab = memo(function DisplayTab({
  settings,
}: DisplayTabProps) {
  const actions = useAdvancedTabState({ settings })

  return (
    <div className="space-y-1">
      <SettingsGrid>
        <DisplayRtaSection settings={settings} actions={actions} />
        <DisplayIssueSection settings={settings} actions={actions} />
        <DisplayErgonomicsSection settings={settings} actions={actions} />
        <DisplayFaderLinkSection settings={settings} actions={actions} />
      </SettingsGrid>
    </div>
  )
})

type DisplayActions = ReturnType<typeof useAdvancedTabState>

interface DisplaySectionProps {
  settings: DetectorSettings
  actions: DisplayActions
}

type DisplayGroupColor = 'amber' | 'blue' | 'green'

const DISPLAY_GROUP_COLOR: Record<DisplayGroupColor, string> = {
  amber: 'var(--console-amber)',
  blue: 'var(--console-blue)',
  green: 'var(--console-green)',
}

const CollapsedDisplayGroup = memo(function CollapsedDisplayGroup({
  title,
  color,
  children,
}: {
  title: string
  color: DisplayGroupColor
  children: ReactNode
}) {
  return (
    <details className="group rounded border border-border/40 bg-card/20 open:bg-card/30">
      <summary className="flex min-h-8 md:min-h-7 cursor-pointer list-none items-center justify-between gap-2 rounded px-2 py-0.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <span
          className="font-mono text-[10px] font-bold uppercase tracking-wide"
          style={{ color: DISPLAY_GROUP_COLOR[color] }}
        >
          {title}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-1 border-t border-border/30 px-2 pb-1 pt-1">
        {children}
      </div>
    </details>
  )
})

const DisplayRtaSection = memo(function DisplayRtaSection({
  settings,
  actions,
}: DisplaySectionProps) {
  return (
    <Section
      title="RTA Display"
      color="blue"
      showTooltip={settings.showTooltips}
      tooltip="Rendering-only controls for the live spectrum. These do not change detection results."
    >
      <div className="space-y-0.5">
        <LEDToggle
          color="cyan"
          checked={settings.spectrumWarmMode}
          onChange={(checked) => actions.updateDisplayField('spectrumWarmMode', checked)}
          label="Warm Spectrum"
          tooltip={settings.showTooltips ? 'Use amber spectrum color instead of blue.' : undefined}
        />
        <LEDToggle
          color="cyan"
          checked={settings.showThresholdLine}
          onChange={(checked) => actions.updateDisplayField('showThresholdLine', checked)}
          label="Threshold Line"
          tooltip={settings.showTooltips ? 'Show the effective detection threshold on the RTA.' : undefined}
        />
        <LEDToggle
          color="cyan"
          checked={settings.showFreqZones}
          onChange={(checked) => actions.updateDisplayField('showFreqZones', checked)}
          label="Frequency Zones"
          tooltip={settings.showTooltips ? 'Show colored frequency-zone guides on the RTA.' : undefined}
        />
        <CollapsedDisplayGroup title="Fine Tune" color="blue">
          <ConsoleSlider
            label="RTA Floor"
            color="blue"
            value={`${settings.rtaDbMin}dB`}
            tooltip={settings.showTooltips ? 'Bottom of the visible RTA scale.' : undefined}
            min={-120}
            max={-60}
            step={5}
            sliderValue={settings.rtaDbMin}
            onChange={(value) => actions.updateDisplayField('rtaDbMin', value)}
            defaultValue={DEFAULT_DISPLAY_PREFS.rtaDbMin}
          />
          <ConsoleSlider
            label="RTA Ceiling"
            color="blue"
            value={`${settings.rtaDbMax}dB`}
            tooltip={settings.showTooltips ? 'Top of the visible RTA scale.' : undefined}
            min={-20}
            max={0}
            step={1}
            sliderValue={settings.rtaDbMax}
            onChange={(value) => actions.updateDisplayField('rtaDbMax', value)}
            defaultValue={DEFAULT_DISPLAY_PREFS.rtaDbMax}
          />
          <ConsoleSlider
            label="Line Width"
            color="blue"
            value={`${settings.spectrumLineWidth.toFixed(1)}px`}
            tooltip={settings.showTooltips ? 'Thickness of the spectrum trace.' : undefined}
            min={0.5}
            max={4}
            step={0.5}
            sliderValue={settings.spectrumLineWidth}
            onChange={(value) => actions.updateDisplayField('spectrumLineWidth', value)}
            defaultValue={DEFAULT_DISPLAY_PREFS.spectrumLineWidth}
          />
          <ConsoleSlider
            label="Canvas FPS"
            color="blue"
            value={`${settings.canvasTargetFps}fps`}
            tooltip={settings.showTooltips ? 'Target rendering rate for the canvas. Lower values save CPU.' : undefined}
            min={15}
            max={60}
            step={5}
            sliderValue={settings.canvasTargetFps}
            onChange={(value) => actions.updateDisplayField('canvasTargetFps', value)}
            defaultValue={DEFAULT_DISPLAY_PREFS.canvasTargetFps}
          />
          <div className="grid grid-cols-2 gap-0.5">
            {(['raw', 'perceptual'] as const).map((mode) => {
              const active = settings.spectrumSmoothingMode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => actions.updateDisplayField('spectrumSmoothingMode', mode)}
                  className={`min-h-8 rounded border px-2 text-xs font-mono font-bold uppercase tracking-wide transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                    active
                      ? 'border-[var(--console-blue)]/35 bg-[var(--console-blue)]/15 text-[var(--console-blue)]'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  {mode === 'raw' ? 'Raw' : '1/3 Oct'}
                </button>
              )
            })}
          </div>
        </CollapsedDisplayGroup>
      </div>
    </Section>
  )
})

const DisplayIssueSection = memo(function DisplayIssueSection({
  settings,
  actions,
}: DisplaySectionProps) {
  return (
    <Section
      title="Issue Cards"
      color="amber"
      showTooltip={settings.showTooltips}
      tooltip="Controls issue-card density and the optional expert information shown with recommendations."
    >
      <div className="space-y-0.5">
        <ConsoleSlider
          label="Max Issues"
          color="amber"
          value={`${settings.maxDisplayedIssues}`}
          tooltip={settings.showTooltips ? 'Maximum issue cards to keep visible.' : undefined}
          min={1}
          max={16}
          step={1}
          sliderValue={settings.maxDisplayedIssues}
          onChange={(value) => actions.updateDisplayField('maxDisplayedIssues', value)}
          defaultValue={DEFAULT_DISPLAY_PREFS.maxDisplayedIssues}
        />
        <LEDToggle
          color="amber"
          checked={settings.showPeqDetails}
          onChange={(checked) => actions.updateDisplayField('showPeqDetails', checked)}
          label="PEQ Details"
          tooltip={settings.showTooltips ? 'Show detailed PEQ frequency, Q, gain, and bandwidth text.' : undefined}
        />
        <CollapsedDisplayGroup title="Card Tuning" color="amber">
          <LEDToggle
            color="amber"
            checked={settings.showAlgorithmScores}
            onChange={(checked) => actions.updateDisplayField('showAlgorithmScores', checked)}
            label="Algorithm Scores"
            tooltip={settings.showTooltips ? 'Show low-level algorithm score readouts on issue cards.' : undefined}
          />
          <ConsoleSlider
            label="Graph Text"
            color="amber"
            value={`${settings.graphFontSize}px`}
            tooltip={settings.showTooltips ? 'Canvas label size for graph annotations.' : undefined}
            min={8}
            max={26}
            step={1}
            sliderValue={settings.graphFontSize}
            onChange={(value) => actions.updateDisplayField('graphFontSize', value)}
            defaultValue={DEFAULT_DISPLAY_PREFS.graphFontSize}
          />
        </CollapsedDisplayGroup>
      </div>
    </Section>
  )
})

const DisplayErgonomicsSection = memo(function DisplayErgonomicsSection({
  settings,
  actions,
}: DisplaySectionProps) {
  return (
    <Section
      title="Ergonomics"
      color="green"
      showTooltip={settings.showTooltips}
      tooltip="Operator-facing UI behavior. These preferences do not alter DSP detection."
    >
      <div className="space-y-0.5">
        <LEDToggle
          color="green"
          checked={settings.showTooltips}
          onChange={(checked) => actions.updateDisplayField('showTooltips', checked)}
          label="Tooltips"
        />
        <LEDToggle
          color="green"
          checked={settings.signalTintEnabled}
          onChange={(checked) => actions.updateDisplayField('signalTintEnabled', checked)}
          label="Signal Tint"
          tooltip={settings.showTooltips ? 'Tint the UI based on active signal severity.' : undefined}
        />
      </div>
    </Section>
  )
})

const DisplayFaderLinkSection = memo(function DisplayFaderLinkSection({
  settings,
  actions,
}: DisplaySectionProps) {
  return (
    <Section
      title="Fader Link"
      color="green"
      showTooltip={settings.showTooltips}
      tooltip="Configure the dual fader strip coupling. These controls only affect the UI faders."
    >
      <div className="space-y-0.5">
        <ConsoleSlider
          label="Link Ratio"
          color="green"
          value={`${settings.faderLinkRatio.toFixed(1)}:1`}
          tooltip={settings.showTooltips ? 'Sensitivity-to-gain visual ratio. 1.0 = equal travel. 2.0 = sensitivity moves twice as fast.' : undefined}
          min={0.5}
          max={2}
          step={0.1}
          sliderValue={settings.faderLinkRatio}
          onChange={(value) => actions.updateDisplayField('faderLinkRatio', value)}
          defaultValue={DEFAULT_DISPLAY_PREFS.faderLinkRatio}
        />
        <CollapsedDisplayGroup title="Home Positions" color="green">
          <ConsoleSlider
            label="Center Gain"
            color="green"
            value={`${settings.faderLinkCenterGainDb}dB`}
            tooltip={settings.showTooltips ? 'Home position for gain fader. Default 0dB (unity).' : undefined}
            min={-20}
            max={20}
            step={1}
            sliderValue={settings.faderLinkCenterGainDb}
            onChange={(value) => actions.updateDisplayField('faderLinkCenterGainDb', value)}
            defaultValue={DEFAULT_DISPLAY_PREFS.faderLinkCenterGainDb}
          />
          <ConsoleSlider
            label="Center Sens"
            color="green"
            value={`${settings.faderLinkCenterSensDb}dB`}
            tooltip={settings.showTooltips ? `Home position for sensitivity fader. Default ${DEFAULT_DISPLAY_PREFS.faderLinkCenterSensDb}dB threshold.` : undefined}
            min={5}
            max={40}
            step={1}
            sliderValue={settings.faderLinkCenterSensDb}
            onChange={(value) => actions.updateDisplayField('faderLinkCenterSensDb', value)}
            defaultValue={DEFAULT_DISPLAY_PREFS.faderLinkCenterSensDb}
          />
        </CollapsedDisplayGroup>
      </div>
    </Section>
  )
})
