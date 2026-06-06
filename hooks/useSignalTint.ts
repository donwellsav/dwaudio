'use client'

/**
 * useSignalTint — drives the console-wide tint color based on detection severity.
 *
 * Sets CSS custom properties (--tint-r, --tint-g, --tint-b) on <html> so that
 * every amber-tinted element (headers, sidebars, accordions, glow lines, labels)
 * shifts color together — like a real analog console's master bus clip indicator.
 *
 * Color progression:
 *   Idle (not running) → slate gray
 *   Listening (no detections) → console blue
 *   Low severity (WHISTLE/INSTRUMENT/POSSIBLE_RING) → console amber
 *   Mid severity (RESONANCE/GROWING) → orange
 *   RUNAWAY → red
 *
 * Performance: Uses refs instead of state for urgency tracking — this hook only
 * writes CSS custom properties (DOM mutation), so React re-renders are unnecessary.
 * The component hosting this hook won't re-render from urgency changes.
 */

import { useMemo, useEffect, useRef, useCallback } from 'react'
import { useAdvisoryData } from '@/contexts/AdvisoryContext'
import { useEngine } from '@/contexts/EngineContext'
import { useMetering } from '@/contexts/MeteringContext'
import { useSettings } from '@/contexts/SettingsContext'
import { getSeverityUrgency } from '@/lib/dsp/severityUtils'

type RGB = [number, number, number]

const TINT_IDLE: RGB   = [100, 116, 139]  // slate gray
const TINT_BLUE: RGB   = [59, 130, 246]   // console blue (low/no signal)
const TINT_GREEN: RGB  = [34, 197, 94]    // healthy (good signal, no feedback)
const TINT_AMBER: RGB  = [245, 158, 11]   // console amber (low severity detection)
const TINT_ORANGE: RGB = [249, 115, 22]   // warning (growing)
const TINT_RED: RGB    = [239, 68, 68]    // RUNAWAY

/** Hold severity for 1s before allowing downgrade — prevents flicker */
const HOLD_MS = 1000

/** Low signal threshold — matches DesktopLayout/MobileLayout (inputLevel < -45) */
const LOW_SIGNAL_THRESHOLD_DB = -45

function tintForUrgency(urgency: number, running: boolean, isLowSignal: boolean): RGB {
  if (!running) return TINT_IDLE
  if (isLowSignal) return TINT_BLUE   // low/no signal — need more gain
  if (urgency === 0) return TINT_GREEN // good signal, no feedback — healthy
  if (urgency <= 2) return TINT_AMBER
  if (urgency <= 4) return TINT_ORANGE
  return TINT_RED
}

/** Apply tint CSS vars + runaway class directly to the DOM (no React re-render). */
function applyTint(rgb: RGB, isRunaway: boolean): void {
  const root = document.documentElement
  root.style.setProperty('--tint-r', String(rgb[0]))
  root.style.setProperty('--tint-g', String(rgb[1]))
  root.style.setProperty('--tint-b', String(rgb[2]))
  if (isRunaway) {
    root.classList.add('tint-runaway')
  } else {
    root.classList.remove('tint-runaway')
  }
}

/**
 * Must be called inside AdvisoryProvider + EngineContext.
 * Reads advisories and engine state from context directly.
 *
 * Hysteresis: upgrades are instant, downgrades are held for HOLD_MS
 * to prevent flicker when advisories briefly disappear and return.
 */
export function useSignalTint(): void {
  const { advisories, dismissedIds } = useAdvisoryData()
  const { isRunning } = useEngine()
  const { inputLevel } = useMetering()
  const { settings } = useSettings()
  const enabled = settings.signalTintEnabled
  const isLowSignal = isRunning && inputLevel < LOW_SIGNAL_THRESHOLD_DB

  const rawUrgency = useMemo(() => {
    if (!isRunning) return 0
    let worst = 0
    for (const a of advisories) {
      if (a.lifecycle !== 'provisional' && !dismissedIds.has(a.id)) {
        worst = Math.max(worst, getSeverityUrgency(a.severity))
      }
    }
    return worst
  }, [isRunning, advisories, dismissedIds])

  // Ref-based hysteresis: upgrades instant, downgrades delayed.
  // No useState — this hook only writes CSS vars, so React re-renders are wasteful.
  const displayedUrgencyRef = useRef(0)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable callback to apply current tint to DOM
  const applyCurrentTint = useCallback(() => {
    const urgency = displayedUrgencyRef.current
    const rgb = enabled ? tintForUrgency(urgency, isRunning, isLowSignal) : TINT_IDLE
    const isRunaway = enabled && urgency >= 5
    applyTint(rgb, isRunaway)
  }, [enabled, isRunning, isLowSignal])

  // Hysteresis logic — writes to ref + applies DOM directly
  useEffect(() => {
    const current = displayedUrgencyRef.current
    if (rawUrgency >= current) {
      // Upgrade or same — apply immediately
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
      displayedUrgencyRef.current = rawUrgency
      applyCurrentTint()
    } else {
      // Downgrade — hold for HOLD_MS before applying
      if (!holdTimerRef.current) {
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null
          displayedUrgencyRef.current = rawUrgency
          applyCurrentTint()
        }, HOLD_MS)
      }
    }
    return () => {
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
    }
  }, [rawUrgency, applyCurrentTint])

  // Re-apply tint when enabled/running/lowSignal changes (these are low-frequency)
  useEffect(() => {
    applyCurrentTint()
  }, [applyCurrentTint])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      applyTint(TINT_IDLE, false)
    }
  }, [])
}
