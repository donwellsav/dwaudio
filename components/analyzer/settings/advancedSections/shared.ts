'use client'

import type { UseAdvancedTabStateReturn } from '@/hooks/useAdvancedTabState'
import type { Algorithm, DetectorSettings } from '@/types/advisory'
import type { DiagnosticsProfile } from '@/types/settings'

export const AVAILABLE_ALGORITHMS: ReadonlyArray<readonly [Algorithm, string]> = [
  ['msd', 'MSD'],
  ['phase', 'Phase'],
  ['spectral', 'Spectral'],
  ['comb', 'Comb'],
  ['ihr', 'IHR'],
  ['ptmr', 'PTMR'],
]

export type AdvancedActions = Pick<
  UseAdvancedTabStateReturn,
  'updateDisplayField' | 'updateDiagnosticField' | 'toggleAlgorithmMode' | 'toggleAlgorithm'
>

export interface AdvancedSectionProps {
  settings: DetectorSettings
  actions: AdvancedActions
}

export function parseFftSize(value: string): 4096 | 8192 | 16384 {
  return parseInt(value, 10) as 4096 | 8192 | 16384
}

export type { DiagnosticsProfile }
