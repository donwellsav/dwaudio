/**
 * useLayeredSettings — Layered settings state manager.
 *
 * Holds the new layered state (mode + environment + live + display + diagnostics)
 * and exposes semantic actions. Produces `derivedSettings: DetectorSettings` via
 * the derivation function for backward compatibility with the existing pipeline.
 *
 * This hook also exposes a legacy shim (`applyLegacyPartial`) that routes
 * old-style `Partial<DetectorSettings>` calls to the appropriate semantic
 * actions. The shim exists only for the transition period (Phases 3–5) and
 * is deleted in Phase 6.
 *
 * @see lib/settings/deriveSettings.ts for the derivation function
 * @see types/settings.ts for the layered type hierarchy
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { deriveDetectorSettings } from '@/lib/settings/deriveSettings'
import {
  DEFAULT_DISPLAY_PREFS,
  DEFAULT_LIVE_OVERRIDES,
  DEFAULT_SESSION_STATE,
  FRESH_START_SESSION_STATE,
} from '@/lib/settings/defaults'
import { MODE_BASELINES } from '@/lib/settings/modeBaselines'
import { applyInitialDetectorSettings } from '@/lib/settings/seedLayeredSettings'
import {
  displayStorageV2,
  sessionStorageV2,
} from '@/lib/storage/settingsStorageV2'
import type { Algorithm, DetectorSettings } from '@/types/advisory'
import type {
  DiagnosticsProfile,
  DisplayPrefs,
  DwaSessionState,
  FocusRange,
  LiveOverrides,
  ModeId,
} from '@/types/settings'

// Legacy key sets and shim removed in Phase 6c — all controls now use semantic actions directly

const DETERMINISTIC_ALGORITHMS: readonly Algorithm[] = ['msd', 'phase', 'spectral', 'comb', 'ihr', 'ptmr']
const DETERMINISTIC_ALGORITHM_SET = new Set<Algorithm>(DETERMINISTIC_ALGORITHMS)

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = isFiniteNumber(value) ? value : fallback
  return Math.max(min, Math.min(max, numeric))
}

function clampOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  if (!isFiniteNumber(value)) return undefined
  return Math.max(min, Math.min(max, value))
}

function sanitizeOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function sanitizeModeId(value: unknown): ModeId {
  return typeof value === 'string' && value in MODE_BASELINES
    ? value as ModeId
    : DEFAULT_SESSION_STATE.modeId
}

function hasExplicitSensitivityOffset(session: unknown): boolean {
  if (!session || typeof session !== 'object') return false
  const liveOverrides = (session as Partial<DwaSessionState>).liveOverrides
  return !!liveOverrides &&
    typeof liveOverrides === 'object' &&
    isFiniteNumber(liveOverrides.sensitivityOffsetDb)
}

function sanitizeFocusRange(value: unknown): FocusRange {
  if (!value || typeof value !== 'object') return DEFAULT_SESSION_STATE.liveOverrides.focusRange
  const range = value as Partial<FocusRange>

  if (range.kind === 'mode-default') return { kind: 'mode-default' }
  if (range.kind === 'preset') {
    const id = 'id' in range ? range.id : undefined
    return id === 'vocal' || id === 'monitor' || id === 'full' || id === 'sub'
      ? { kind: 'preset', id }
      : DEFAULT_SESSION_STATE.liveOverrides.focusRange
  }
  if (range.kind === 'custom' && isFiniteNumber(range.minHz) && isFiniteNumber(range.maxHz)) {
    const minHz = clampNumber(range.minHz, 20, 20, 20000)
    const maxHz = clampNumber(range.maxHz, 20000, 20, 20000)
    if (minHz < maxHz) return { kind: 'custom', minHz, maxHz }
  }

  return DEFAULT_SESSION_STATE.liveOverrides.focusRange
}

function sanitizeEnvironment(environment: DwaSessionState['environment']): DwaSessionState['environment'] {
  return {
    mainsHumEnabled: typeof environment.mainsHumEnabled === 'boolean'
      ? environment.mainsHumEnabled
      : DEFAULT_SESSION_STATE.environment.mainsHumEnabled,
    mainsHumFundamental: environment.mainsHumFundamental === 'auto' ||
      environment.mainsHumFundamental === 50 ||
      environment.mainsHumFundamental === 60
      ? environment.mainsHumFundamental
      : DEFAULT_SESSION_STATE.environment.mainsHumFundamental,
  }
}

function sanitizeLiveOverrides(liveOverrides: DwaSessionState['liveOverrides']): DwaSessionState['liveOverrides'] {
  return {
    sensitivityOffsetDb: clampNumber(
      liveOverrides.sensitivityOffsetDb,
      DEFAULT_SESSION_STATE.liveOverrides.sensitivityOffsetDb,
      -30,
      30,
    ),
    inputGainDb: clampNumber(liveOverrides.inputGainDb, DEFAULT_SESSION_STATE.liveOverrides.inputGainDb, -24, 24),
    autoGainEnabled: typeof liveOverrides.autoGainEnabled === 'boolean'
      ? liveOverrides.autoGainEnabled
      : DEFAULT_SESSION_STATE.liveOverrides.autoGainEnabled,
    autoGainTargetDb: clampNumber(
      liveOverrides.autoGainTargetDb,
      DEFAULT_SESSION_STATE.liveOverrides.autoGainTargetDb,
      -48,
      -3,
    ),
    focusRange: sanitizeFocusRange(liveOverrides.focusRange),
    eqStyle: liveOverrides.eqStyle === 'surgical' || liveOverrides.eqStyle === 'heavy' || liveOverrides.eqStyle === 'mode-default'
      ? liveOverrides.eqStyle
      : DEFAULT_SESSION_STATE.liveOverrides.eqStyle,
  }
}

function sanitizeDiagnostics(diagnostics: DiagnosticsProfile): DiagnosticsProfile {
  const enabledAlgorithms = Array.isArray(diagnostics.enabledAlgorithms)
    ? diagnostics.enabledAlgorithms.filter((algorithm): algorithm is Algorithm =>
        DETERMINISTIC_ALGORITHM_SET.has(algorithm as Algorithm),
      )
    : DEFAULT_SESSION_STATE.diagnostics.enabledAlgorithms

  return {
    adaptivePhaseSkip: sanitizeOptionalBoolean(diagnostics.adaptivePhaseSkip),
    algorithmMode: diagnostics.algorithmMode === 'custom' ? 'custom' : 'auto',
    enabledAlgorithms: enabledAlgorithms.length > 0
      ? enabledAlgorithms
      : DEFAULT_SESSION_STATE.diagnostics.enabledAlgorithms,
    thresholdMode: diagnostics.thresholdMode === 'absolute' ||
      diagnostics.thresholdMode === 'relative' ||
      diagnostics.thresholdMode === 'hybrid'
      ? diagnostics.thresholdMode
      : DEFAULT_SESSION_STATE.diagnostics.thresholdMode,
    noiseFloorAttackMs: clampNumber(diagnostics.noiseFloorAttackMs, DEFAULT_SESSION_STATE.diagnostics.noiseFloorAttackMs, 50, 1000),
    noiseFloorReleaseMs: clampNumber(diagnostics.noiseFloorReleaseMs, DEFAULT_SESSION_STATE.diagnostics.noiseFloorReleaseMs, 200, 5000),
    maxTracks: clampNumber(diagnostics.maxTracks, DEFAULT_SESSION_STATE.diagnostics.maxTracks, 8, 128),
    trackTimeoutMs: diagnostics.trackTimeoutMs === 'mode-default'
      ? 'mode-default'
      : clampNumber(diagnostics.trackTimeoutMs, 1000, 200, 5000),
    harmonicToleranceCents: clampNumber(
      diagnostics.harmonicToleranceCents,
      DEFAULT_SESSION_STATE.diagnostics.harmonicToleranceCents,
      25,
      400,
    ),
    peakMergeCents: clampNumber(diagnostics.peakMergeCents, DEFAULT_SESSION_STATE.diagnostics.peakMergeCents, 10, 200),
    confidenceThresholdOverride: clampOptionalNumber(diagnostics.confidenceThresholdOverride, 0.2, 0.8),
    growthRateThresholdOverride: clampOptionalNumber(diagnostics.growthRateThresholdOverride, 0.5, 8),
    smoothingTimeConstantOverride: clampOptionalNumber(diagnostics.smoothingTimeConstantOverride, 0, 0.95),
    sustainMsOverride: clampOptionalNumber(diagnostics.sustainMsOverride, 100, 2000),
    clearMsOverride: clampOptionalNumber(diagnostics.clearMsOverride, 100, 2000),
    prominenceDbOverride: clampOptionalNumber(diagnostics.prominenceDbOverride, 4, 30),
    aWeightingOverride: sanitizeOptionalBoolean(diagnostics.aWeightingOverride),
    ignoreWhistleOverride: sanitizeOptionalBoolean(diagnostics.ignoreWhistleOverride),
    fftSizeOverride: diagnostics.fftSizeOverride === 4096 ||
      diagnostics.fftSizeOverride === 8192 ||
      diagnostics.fftSizeOverride === 16384
      ? diagnostics.fftSizeOverride
      : undefined,
    ringThresholdDbOverride: clampOptionalNumber(diagnostics.ringThresholdDbOverride, 1, 12),
    formantGateOverride: clampOptionalNumber(diagnostics.formantGateOverride, 0, 1),
    chromaticGateOverride: clampOptionalNumber(diagnostics.chromaticGateOverride, 0, 1),
    combSweepOverride: clampOptionalNumber(diagnostics.combSweepOverride, 0, 1),
    ihrGateOverride: clampOptionalNumber(diagnostics.ihrGateOverride, 0, 1),
    ptmrGateOverride: clampOptionalNumber(diagnostics.ptmrGateOverride, 0, 1),
    mainsHumGateOverride: clampOptionalNumber(diagnostics.mainsHumGateOverride, 0, 1),
  }
}

function sanitizeSession(session: DwaSessionState): DwaSessionState {
  return {
    modeId: sanitizeModeId(session.modeId),
    environment: sanitizeEnvironment(session.environment),
    liveOverrides: sanitizeLiveOverrides(session.liveOverrides),
    diagnostics: sanitizeDiagnostics(session.diagnostics),
  }
}

function sanitizeDisplayPrefs(display: DisplayPrefs): DisplayPrefs {
  const rtaDbMin = clampNumber(display.rtaDbMin, DEFAULT_DISPLAY_PREFS.rtaDbMin, -140, -10)
  const rtaDbMax = clampNumber(display.rtaDbMax, DEFAULT_DISPLAY_PREFS.rtaDbMax, -80, 20)

  return {
    maxDisplayedIssues: Math.round(clampNumber(display.maxDisplayedIssues, DEFAULT_DISPLAY_PREFS.maxDisplayedIssues, 1, 24)),
    graphFontSize: Math.round(clampNumber(display.graphFontSize, DEFAULT_DISPLAY_PREFS.graphFontSize, 8, 26)),
    showTooltips: typeof display.showTooltips === 'boolean' ? display.showTooltips : DEFAULT_DISPLAY_PREFS.showTooltips,
    showAlgorithmScores: typeof display.showAlgorithmScores === 'boolean'
      ? display.showAlgorithmScores
      : DEFAULT_DISPLAY_PREFS.showAlgorithmScores,
    showPeqDetails: typeof display.showPeqDetails === 'boolean' ? display.showPeqDetails : DEFAULT_DISPLAY_PREFS.showPeqDetails,
    showFreqZones: typeof display.showFreqZones === 'boolean' ? display.showFreqZones : DEFAULT_DISPLAY_PREFS.showFreqZones,
    spectrumWarmMode: typeof display.spectrumWarmMode === 'boolean'
      ? display.spectrumWarmMode
      : DEFAULT_DISPLAY_PREFS.spectrumWarmMode,
    spectrumSmoothingMode: display.spectrumSmoothingMode === 'raw' || display.spectrumSmoothingMode === 'perceptual'
      ? display.spectrumSmoothingMode
      : DEFAULT_DISPLAY_PREFS.spectrumSmoothingMode,
    rtaDbMin,
    rtaDbMax: Math.max(rtaDbMax, rtaDbMin + 10),
    spectrumLineWidth: clampNumber(display.spectrumLineWidth, DEFAULT_DISPLAY_PREFS.spectrumLineWidth, 0.5, 4),
    showThresholdLine: typeof display.showThresholdLine === 'boolean'
      ? display.showThresholdLine
      : DEFAULT_DISPLAY_PREFS.showThresholdLine,
    canvasTargetFps: Math.round(clampNumber(display.canvasTargetFps, DEFAULT_DISPLAY_PREFS.canvasTargetFps, 15, 60)),
    faderMode: display.faderMode === 'gain' || display.faderMode === 'sensitivity'
      ? display.faderMode
      : DEFAULT_DISPLAY_PREFS.faderMode,
    faderLinkMode: display.faderLinkMode === 'unlinked' ||
      display.faderLinkMode === 'linked' ||
      display.faderLinkMode === 'linked-reversed'
      ? display.faderLinkMode
      : DEFAULT_DISPLAY_PREFS.faderLinkMode,
    faderLinkRatio: clampNumber(display.faderLinkRatio, DEFAULT_DISPLAY_PREFS.faderLinkRatio, 0.5, 2),
    faderLinkCenterGainDb: clampNumber(display.faderLinkCenterGainDb, DEFAULT_DISPLAY_PREFS.faderLinkCenterGainDb, -24, 24),
    faderLinkCenterSensDb: clampNumber(display.faderLinkCenterSensDb, DEFAULT_DISPLAY_PREFS.faderLinkCenterSensDb, 2, 50),
    signalTintEnabled: typeof display.signalTintEnabled === 'boolean'
      ? display.signalTintEnabled
      : DEFAULT_DISPLAY_PREFS.signalTintEnabled,
  }
}

// ─── Return type ─────────────────────────────────────────────────────────────

export interface UseLayeredSettingsReturn {
  /** The derived DetectorSettings — compatible with the existing pipeline */
  derivedSettings: DetectorSettings

  /** Direct access to layered state (for new UI surfaces) */
  session: DwaSessionState
  display: DisplayPrefs

  // ── Semantic actions ─────────────────────────────────────────────────
  setMode: (modeId: ModeId) => void
  setSensitivityOffset: (db: number) => void
  setInputGain: (db: number) => void
  setAutoGain: (enabled: boolean, targetDb?: number) => void
  setFocusRange: (range: FocusRange) => void
  setEqStyle: (style: LiveOverrides['eqStyle']) => void
  updateDisplay: (partial: Partial<DisplayPrefs>) => void
  updateDiagnostics: (partial: Partial<DiagnosticsProfile>) => void
  updateLiveOverrides: (partial: Partial<LiveOverrides>) => void
  resetAll: () => void

}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useLayeredSettings(initialSettings: Partial<DetectorSettings> = {}): UseLayeredSettingsReturn {
  const [initialState] = useState<{
    session: DwaSessionState
    display: DisplayPrefs
    shouldPersistSessionOnMount: boolean
    shouldPersistDisplayOnMount: boolean
  }>(() => {
    const hasStoredSession = typeof window !== 'undefined' && localStorage.getItem('dwa-v2-session') !== null
    const hasStoredDisplay = typeof window !== 'undefined' && localStorage.getItem('dwa-v2-display') !== null
    const hasInitialSettings = Object.keys(initialSettings).length > 0
    const rawSession = hasStoredSession ? sessionStorageV2.load() : undefined
    const storedDisplay = displayStorageV2.load()
    // Validate nested branches — malformed localStorage can have null/non-object values
    const storedSession = rawSession && typeof rawSession === 'object' ? rawSession : {} as Partial<DwaSessionState>
    const storedMode = sanitizeModeId(storedSession.modeId)
    const useFreshStartSession = !hasInitialSettings &&
      (!hasStoredSession ||
        (!hasExplicitSensitivityOffset(rawSession) && storedMode === 'speech'))
    const sessionFallback = useFreshStartSession ? FRESH_START_SESSION_STATE : DEFAULT_SESSION_STATE
    const baseSession: DwaSessionState = {
      ...sessionFallback,
      ...storedSession,
      environment: {
        ...sessionFallback.environment,
        ...(storedSession.environment && typeof storedSession.environment === 'object' ? storedSession.environment : {}),
      },
      liveOverrides: {
        ...sessionFallback.liveOverrides,
        ...(storedSession.liveOverrides && typeof storedSession.liveOverrides === 'object' ? storedSession.liveOverrides : {}),
      },
      diagnostics: {
        ...sessionFallback.diagnostics,
        ...(storedSession.diagnostics && typeof storedSession.diagnostics === 'object' ? storedSession.diagnostics : {}),
      },
    }
    const baseDisplay: DisplayPrefs = {
      ...DEFAULT_DISPLAY_PREFS,
      ...storedDisplay,
    }
    const seededState = applyInitialDetectorSettings(baseSession, baseDisplay, initialSettings)
    const sanitizedSession = sanitizeSession(seededState.session)
    const sanitizedDisplay = sanitizeDisplayPrefs(seededState.display)
    return {
      ...seededState,
      session: sanitizedSession,
      display: sanitizedDisplay,
      shouldPersistSessionOnMount: hasStoredSession &&
        !hasInitialSettings &&
        JSON.stringify(rawSession) !== JSON.stringify(sanitizedSession),
      shouldPersistDisplayOnMount: hasStoredDisplay &&
        !hasInitialSettings &&
        JSON.stringify(storedDisplay) !== JSON.stringify(sanitizedDisplay),
    }
  })

  // Load initial state from v2 storage, backfilling new fields from defaults.
  // Flat spread works for DisplayPrefs; nested merge needed for DwaSessionState
  // because environment/liveOverrides/diagnostics are objects that gain fields over time.
  const [session, setSession] = useState<DwaSessionState>(initialState.session)
  const [display, setDisplay] = useState<DisplayPrefs>(initialState.display)

  // ── Persist on change (debounced to 100ms for slider performance) ─────
  const sessionPersistRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const displayPersistRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!initialState.shouldPersistSessionOnMount) return
    sessionStorageV2.save(initialState.session)
  }, [initialState])

  useEffect(() => {
    if (!initialState.shouldPersistDisplayOnMount) return
    displayStorageV2.save(initialState.display)
  }, [initialState])

  const updateSession = useCallback((updater: (prev: DwaSessionState) => DwaSessionState) => {
    setSession(prev => {
      const next = updater(prev)
      clearTimeout(sessionPersistRef.current)
      sessionPersistRef.current = setTimeout(() => sessionStorageV2.save(next), 100)
      return next
    })
  }, [])

  const updateDisplayState = useCallback((updater: (prev: DisplayPrefs) => DisplayPrefs) => {
    setDisplay(prev => {
      const next = updater(prev)
      clearTimeout(displayPersistRef.current)
      displayPersistRef.current = setTimeout(() => displayStorageV2.save(next), 100)
      return next
    })
  }, [])

  // ── Semantic actions ───────────────────────────────────────────────────

  const setMode = useCallback((modeId: ModeId) => {
    updateSession(prev => ({
      ...prev,
      modeId,
      // Reset live overrides to defaults when switching modes,
      // but preserve gain and auto-gain settings
      liveOverrides: {
        ...DEFAULT_LIVE_OVERRIDES,
        inputGainDb: prev.liveOverrides.inputGainDb,
        autoGainEnabled: prev.liveOverrides.autoGainEnabled,
        autoGainTargetDb: prev.liveOverrides.autoGainTargetDb,
      },
    }))
  }, [updateSession])

  const setSensitivityOffset = useCallback((db: number) => {
    updateSession(prev => ({
      ...prev,
      liveOverrides: { ...prev.liveOverrides, sensitivityOffsetDb: db },
    }))
  }, [updateSession])

  const setInputGain = useCallback((db: number) => {
    updateSession(prev => ({
      ...prev,
      liveOverrides: { ...prev.liveOverrides, inputGainDb: db },
    }))
  }, [updateSession])

  const setAutoGain = useCallback((enabled: boolean, targetDb?: number) => {
    updateSession(prev => ({
      ...prev,
      liveOverrides: {
        ...prev.liveOverrides,
        autoGainEnabled: enabled,
        ...(targetDb !== undefined ? { autoGainTargetDb: targetDb } : {}),
      },
    }))
  }, [updateSession])

  const setFocusRange = useCallback((range: FocusRange) => {
    updateSession(prev => ({
      ...prev,
      liveOverrides: { ...prev.liveOverrides, focusRange: range },
    }))
  }, [updateSession])

  const setEqStyle = useCallback((style: LiveOverrides['eqStyle']) => {
    updateSession(prev => ({
      ...prev,
      liveOverrides: { ...prev.liveOverrides, eqStyle: style },
    }))
  }, [updateSession])

  const updateDisplay = useCallback((partial: Partial<DisplayPrefs>) => {
    updateDisplayState(prev => ({ ...prev, ...partial }))
  }, [updateDisplayState])

  const updateDiagnostics = useCallback((partial: Partial<DiagnosticsProfile>) => {
    updateSession(prev => ({
      ...prev,
      diagnostics: sanitizeDiagnostics({ ...prev.diagnostics, ...partial }),
    }))
  }, [updateSession])

  const updateLiveOverrides = useCallback((partial: Partial<LiveOverrides>) => {
    updateSession(prev => ({
      ...prev,
      liveOverrides: { ...prev.liveOverrides, ...partial },
    }))
  }, [updateSession])

  const resetAll = useCallback(() => {
    // Cancel any in-flight debounced persistence to prevent stale data
    // from overwriting the clean defaults after reset (P1 race condition fix)
    clearTimeout(sessionPersistRef.current)
    clearTimeout(displayPersistRef.current)
    setSession(FRESH_START_SESSION_STATE)
    setDisplay(DEFAULT_DISPLAY_PREFS)
    sessionStorageV2.save(FRESH_START_SESSION_STATE)
    displayStorageV2.save(DEFAULT_DISPLAY_PREFS)
  }, [])

  // Legacy shim (applyLegacyPartial) removed in Phase 6c.
  // All UI controls now call semantic actions directly.

  // ── Derive DetectorSettings ────────────────────────────────────────────

  const baseline = MODE_BASELINES[session.modeId]

  const derivedSettings = useMemo(() =>
    deriveDetectorSettings(
      baseline,
      session.environment,
      session.liveOverrides,
      display,
      session.diagnostics,
    ),
  [baseline, session.environment, session.liveOverrides, display, session.diagnostics],
  )

  return {
    derivedSettings,
    session,
    display,
    setMode,
    setSensitivityOffset,
    setInputGain,
    setAutoGain,
    setFocusRange,
    setEqStyle,
    updateDisplay,
    updateDiagnostics,
    updateLiveOverrides,
    resetAll,
  }
}
