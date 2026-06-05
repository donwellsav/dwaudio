'use client'

import { useCallback, memo } from 'react'
import { SingleFader } from './SingleFader'
import { useFaderLink } from '@/hooks/useFaderLink'
import type { FaderLinkMode } from '@/hooks/useFaderLink'
import { useSensitivityGuidance } from '@/hooks/useSensitivityGuidance'

interface DualFaderStripProps {
  gainDb: number
  onGainChange: (db: number) => void
  level: number
  autoGainEnabled: boolean
  autoGainDb?: number
  autoGainLocked: boolean
  onAutoGainToggle: (enabled: boolean) => void
  noiseFloorDb: number | null
  sensitivityDb: number
  onSensitivityChange: (db: number) => void
  activeAdvisoryCount: number
  linkMode: FaderLinkMode
  linkRatio: number
  linkCenterGainDb: number
  linkCenterSensDb: number
  onLinkModeChange: (mode: FaderLinkMode) => void
  isRunning: boolean
}

const LINK_MODES: { mode: FaderLinkMode; icon: string; title: string; ariaLabel: string }[] = [
  {
    mode: 'unlinked',
    icon: '⊘',
    title: 'Unlinked - independent faders',
    ariaLabel: 'Use independent gain and sensitivity faders',
  },
  {
    mode: 'linked',
    icon: '⛓',
    title: 'Linked - both move same direction',
    ariaLabel: 'Link gain and sensitivity faders in the same direction',
  },
  {
    mode: 'linked-reversed',
    icon: '⛓̸',
    title: 'Linked reversed - opposite directions',
    ariaLabel: 'Link gain and sensitivity faders in opposite directions',
  },
]

/**
 * Dual vertical fader strip: Gain (left) and Sensitivity (right) with optional linking.
 *
 * Link math stays in useFaderLink. Sensitivity guidance is shared with the
 * mobile sidecar so both surfaces react the same way to silence and overload.
 */
export const DualFaderStrip = memo(function DualFaderStrip({
  gainDb,
  onGainChange,
  level,
  autoGainEnabled,
  autoGainDb,
  autoGainLocked,
  onAutoGainToggle,
  noiseFloorDb,
  sensitivityDb,
  onSensitivityChange,
  activeAdvisoryCount,
  linkMode,
  linkRatio,
  linkCenterGainDb,
  linkCenterSensDb,
  onLinkModeChange,
  isRunning,
}: DualFaderStripProps) {
  const guidance = useSensitivityGuidance({
    isRunning,
    inputLevel: level,
    activeAdvisoryCount,
    sensitivityDb,
  })

  const { handleGainDrag, handleSensDrag, goHome } = useFaderLink({
    linkMode,
    linkRatio,
    centerGainDb: linkCenterGainDb,
    centerSensDb: linkCenterSensDb,
    gainDb,
    sensitivityDb,
    onGainChange,
    onSensitivityChange,
    onAutoGainToggle,
  })

  const handleGainChange = useCallback((db: number) => {
    if (autoGainEnabled) onAutoGainToggle(false)
    handleGainDrag(db)
  }, [autoGainEnabled, onAutoGainToggle, handleGainDrag])

  return (
    <div className="flex flex-col h-full items-center py-2 gap-1 select-none">
      <div className="flex-shrink-0 flex w-full rounded-md overflow-hidden border border-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.22)] bg-[rgba(0,0,0,0.15)]">
        {LINK_MODES.map(({ mode, icon, title, ariaLabel }) => (
          <button
            key={mode}
            onClick={() => onLinkModeChange(mode)}
            className={`flex-1 py-1 text-center text-dwa-sm font-bold transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
              linkMode === mode
                ? 'bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.15)] text-[var(--console-amber)]'
                : 'bg-transparent text-muted-foreground hover:text-foreground/70'
            }`}
            title={title}
            aria-label={ariaLabel}
            aria-pressed={linkMode === mode}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className="flex-shrink-0 flex w-full gap-0.5">
        <button
          onClick={goHome}
          className="flex-1 py-1 rounded text-dwa-sm font-bold uppercase tracking-wider text-center transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.06)] text-[var(--console-amber)]/70 border border-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.18)] hover:bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.12)]"
          title={`Home: ${linkCenterGainDb}dB gain, ${linkCenterSensDb}dB sensitivity`}
          aria-label="Reset faders to home position"
        >
          Home
        </button>

        <button
          onClick={() => onAutoGainToggle(!autoGainEnabled)}
          className={`flex-1 py-1 rounded flex items-center justify-center gap-1 text-dwa-sm font-bold uppercase tracking-wider transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
            autoGainEnabled
              ? autoGainLocked
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/40'
                : 'bg-amber-100 text-amber-800 border border-amber-400 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/40 motion-safe:animate-pulse'
              : 'bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.06)] text-[var(--console-amber)]/70 border border-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.18)] hover:bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.12)]'
          }`}
          title={
            autoGainEnabled
              ? autoGainLocked
                ? `Gain locked at ${autoGainDb ?? 0}dB - click for manual`
                : 'Calibrating auto-gain... click for manual'
              : 'Manual gain - click for auto'
          }
          aria-label={
            autoGainEnabled
              ? autoGainLocked
                ? 'Auto gain locked, switch to manual'
                : 'Auto gain calibrating, switch to manual'
              : 'Switch to auto gain'
          }
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            autoGainEnabled
              ? autoGainLocked
                ? 'bg-emerald-600 dark:bg-emerald-400 shadow-[0_0_4px_var(--fader-glow-locked)]'
                : 'bg-amber-600 dark:bg-amber-400 shadow-[0_0_4px_var(--fader-glow-cal)]'
              : 'bg-[var(--console-amber)] shadow-[0_0_4px_rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.4)]'
          }`} />
          {autoGainEnabled ? (autoGainLocked ? 'Lock' : 'Cal') : 'Man'}
        </button>
      </div>

      <div className="w-full flex-shrink-0 h-px bg-gradient-to-r from-transparent via-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.12)] to-transparent" />

      <div className="flex-1 min-h-0 flex flex-row gap-0.5 w-full">
        <SingleFader
          mode="gain"
          value={gainDb}
          onChange={handleGainChange}
          level={level}
          min={-40}
          max={40}
          label="GAIN"
          autoGainEnabled={autoGainEnabled}
          autoGainDb={autoGainDb}
          autoGainLocked={autoGainLocked}
          onAutoGainToggle={onAutoGainToggle}
          noiseFloorDb={noiseFloorDb}
          homeValue={linkCenterGainDb}
          width={64}
        />
        <SingleFader
          mode="sensitivity"
          value={sensitivityDb}
          onChange={handleSensDrag}
          min={2}
          max={50}
          label="SENS"
          guidance={guidance}
          homeValue={linkCenterSensDb}
          width={64}
        />
      </div>
    </div>
  )
})
