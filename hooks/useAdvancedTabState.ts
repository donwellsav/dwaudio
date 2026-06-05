'use client'

import { useCallback } from 'react'
import { useSettings } from '@/contexts/SettingsContext'
import type { Algorithm, DetectorSettings } from '@/types/advisory'
import type { DiagnosticsProfile, DisplayPrefs } from '@/types/settings'

const DEFAULT_ENABLED_ALGORITHMS: readonly Algorithm[] = ['msd', 'phase', 'spectral', 'comb', 'ihr', 'ptmr']

function fieldPatch<T, K extends keyof T>(field: K, value: T[K]): Pick<T, K> {
  return { [field]: value } as Pick<T, K>
}

interface UseAdvancedTabStateParams {
  settings: DetectorSettings
}

export interface UseAdvancedTabStateReturn {
  updateDisplayField: <K extends keyof DisplayPrefs>(field: K, value: DisplayPrefs[K]) => void
  updateDiagnosticField: <K extends keyof DiagnosticsProfile>(field: K, value: DiagnosticsProfile[K]) => void
  toggleAlgorithmMode: () => void
  toggleAlgorithm: (algorithm: Algorithm) => void
}

export function useAdvancedTabState({
  settings,
}: UseAdvancedTabStateParams): UseAdvancedTabStateReturn {
  const { updateDisplay, updateDiagnostics } = useSettings()

  const updateDisplayField = useCallback(function updateDisplayField<K extends keyof DisplayPrefs>(
    field: K,
    value: DisplayPrefs[K],
  ) {
    updateDisplay(fieldPatch<DisplayPrefs, K>(field, value))
  }, [updateDisplay])

  const updateDiagnosticField = useCallback(function updateDiagnosticField<K extends keyof DiagnosticsProfile>(
    field: K,
    value: DiagnosticsProfile[K],
  ) {
    updateDiagnostics(fieldPatch<DiagnosticsProfile, K>(field, value))
  }, [updateDiagnostics])

  const toggleAlgorithmMode = useCallback(() => {
    updateDiagnosticField('algorithmMode', settings.algorithmMode === 'auto' ? 'custom' : 'auto')
  }, [settings.algorithmMode, updateDiagnosticField])

  const toggleAlgorithm = useCallback((algorithm: Algorithm) => {
    if (settings.algorithmMode === 'auto') return

    const current = settings.enabledAlgorithms ?? [...DEFAULT_ENABLED_ALGORITHMS]
    const isEnabled = current.includes(algorithm)

    if (isEnabled) {
      const next = current.filter((value) => value !== algorithm)
      if (next.length === 0) {
        updateDiagnosticField('algorithmMode', 'auto')
        return
      }
      updateDiagnosticField('enabledAlgorithms', next)
      return
    }

    updateDiagnosticField('enabledAlgorithms', [...current, algorithm])
  }, [settings.algorithmMode, settings.enabledAlgorithms, updateDiagnosticField])

  return {
    updateDisplayField,
    updateDiagnosticField,
    toggleAlgorithmMode,
    toggleAlgorithm,
  }
}
