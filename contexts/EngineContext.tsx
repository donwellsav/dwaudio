'use client'

import { createContext, useContext } from 'react'
import type { AudioDevice } from '@/hooks/useAudioDevices'
import type { DSPWorkerHandle } from '@/hooks/useDSPWorker'

// ── Context value ───────────────────────────────────────────────────────────

export interface EngineContextValue {
  /** Whether the audio engine is currently running */
  isRunning: boolean
  /** Whether the audio engine is in the process of starting */
  isStarting: boolean
  /** Human-readable error message from the audio engine, or null */
  error: string | null
  /** Human-readable error message from the DSP worker, or null */
  workerError: string | null
  /** Start analysis (auto-injects persisted device preference) */
  start: () => Promise<void>
  /** Stop analysis */
  stop: () => void
  /** Switch to a different audio input device mid-session */
  switchDevice: (deviceId: string) => Promise<void>
  /** Available audio input devices */
  devices: AudioDevice[]
  /** Currently selected device ID (empty string = system default) */
  selectedDeviceId: string
  /** Switch device with persistence */
  handleDeviceChange: (deviceId: string) => void
  /** DSP worker handle for local analysis wiring */
  dspWorker: DSPWorkerHandle
}

export const EngineContext = createContext<EngineContextValue | null>(null)

// ── Hook ────────────────────────────────────────────────────────────────────

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error('useEngine must be used within <AudioAnalyzerProvider>')
  return ctx
}
