'use client'

import { memo } from 'react'
import { SingleFader } from './SingleFader'
import type { FaderGuidance } from './faderTypes'

interface MobileSidecarFaderProps {
  mobileFaderMode: 'gain' | 'sensitivity'
  mobileFaderValue: number
  mobileFaderOnChange: (db: number) => void
  toggleMobileFaderMode: () => void
  inputLevel: number
  isAutoGain: boolean
  autoGainDb?: number
  autoGainLocked?: boolean
  setAutoGain: (enabled: boolean, targetDb?: number) => void
  noiseFloorDb: number | null
  mobileGuidance: FaderGuidance
  compact?: boolean
  homeValue: number
}

export const MobileSidecarFader = memo(function MobileSidecarFader({
  mobileFaderMode,
  mobileFaderValue,
  mobileFaderOnChange,
  toggleMobileFaderMode,
  inputLevel,
  isAutoGain,
  autoGainDb,
  autoGainLocked,
  setAutoGain,
  noiseFloorDb,
  mobileGuidance,
  compact = false,
  homeValue,
}: MobileSidecarFaderProps) {
  const faderWidth = compact ? 42 : 44

  return (
    <>
      <button
        onClick={toggleMobileFaderMode}
        className={`flex-shrink-0 font-bold uppercase tracking-wider text-center cursor-pointer transition-colors ${
          compact ? 'py-0.5 text-dwa-sm' : 'py-1 text-dwa-sm'
        } ${
          mobileFaderMode === 'sensitivity' ? 'text-blue-400' : 'text-[var(--console-amber)]'
        }`}
        aria-label={`Switch to ${mobileFaderMode === 'gain' ? 'sensitivity' : 'gain'} fader`}
      >
        {mobileFaderMode === 'sensitivity' ? 'Sens' : 'Gain'}
      </button>
      <div className="flex-1 min-h-0">
        <SingleFader
          mode={mobileFaderMode}
          value={mobileFaderValue}
          onChange={mobileFaderOnChange}
          level={inputLevel}
          min={mobileFaderMode === 'sensitivity' ? 2 : -40}
          max={mobileFaderMode === 'sensitivity' ? 50 : 40}
          label=""
          autoGainEnabled={mobileFaderMode === 'gain' ? isAutoGain : false}
          autoGainDb={autoGainDb}
          autoGainLocked={autoGainLocked}
          onAutoGainToggle={mobileFaderMode === 'gain' ? (enabled) => setAutoGain(enabled) : undefined}
          noiseFloorDb={mobileFaderMode === 'gain' ? noiseFloorDb : null}
          guidance={mobileFaderMode === 'sensitivity' ? mobileGuidance : undefined}
          width={faderWidth}
          homeValue={homeValue}
        />
      </div>
    </>
  )
})
