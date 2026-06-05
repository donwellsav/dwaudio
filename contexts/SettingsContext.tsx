'use client'

import { createContext, useContext } from 'react'
import type { DetectorSettings, OperationMode } from '@/types/advisory'
import type {
  DiagnosticsProfile,
  DisplayPrefs,
  DwaSessionState,
  FocusRange,
  LiveOverrides,
  ModeId,
} from '@/types/settings'

// ── Context value ───────────────────────────────────────────────────────────

export interface SettingsContextValue {
  /** Current detector settings (derived from layered state) */
  settings: DetectorSettings
  /** Reset all settings to defaults */
  resetSettings: () => void
  /** Switch operation mode (applies full preset) */
  handleModeChange: (mode: OperationMode) => void
  /** Update frequency range bounds */
  handleFreqRangeChange: (min: number, max: number) => void

  // ── Layered state ──────────────────────────────────────────────────────
  /** Direct access to layered session state */
  session: DwaSessionState
  /** Direct access to layered display preferences */
  displayPrefs: DisplayPrefs

  // ── Semantic actions ───────────────────────────────────────────────────
  /** Set operation mode — applies full baseline, resets live overrides */
  setMode: (modeId: ModeId) => void
  /** Set live sensitivity offset (dB above mode baseline) */
  setSensitivityOffset: (db: number) => void
  /** Set input gain (dB) */
  setInputGain: (db: number) => void
  /** Set auto-gain mode */
  setAutoGain: (enabled: boolean, targetDb?: number) => void
  /** Set focus frequency range */
  setFocusRange: (range: FocusRange) => void
  /** Set EQ recommendation style */
  setEqStyle: (style: LiveOverrides['eqStyle']) => void
  /** Update display preferences (partial merge) */
  updateDisplay: (partial: Partial<DisplayPrefs>) => void
  /** Update diagnostics profile (partial merge) */
  updateDiagnostics: (partial: Partial<DiagnosticsProfile>) => void
  /** Update live overrides (partial merge) */
  updateLiveOverrides: (partial: Partial<LiveOverrides>) => void
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

// ── Hook ────────────────────────────────────────────────────────────────────

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within <AudioAnalyzerProvider>')
  return ctx
}
