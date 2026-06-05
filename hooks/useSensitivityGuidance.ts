'use client'

import { useMemo } from 'react'
import type { FaderGuidance } from '@/components/analyzer/faderTypes'

interface SensitivityGuidanceParams {
  enabled?: boolean
  isRunning: boolean
  inputLevel: number
  activeAdvisoryCount: number
  sensitivityDb: number
}

interface DerivedSensitivityGuidanceParams {
  enabled: boolean
  isRunning: boolean
  activeAdvisoryCount: number
  sensitivityDb: number
}

export function deriveSensitivityGuidance({
  enabled,
  isRunning,
  activeAdvisoryCount,
  sensitivityDb,
}: DerivedSensitivityGuidanceParams): FaderGuidance {
  if (!enabled || !isRunning) return { direction: 'none', urgency: 'none' }
  if (activeAdvisoryCount >= 3) return { direction: 'down', urgency: 'warning' }

  if (sensitivityDb > 35) {
    return {
      direction: 'up',
      urgency: sensitivityDb >= 42 ? 'warning' : 'hint',
    }
  }

  if (sensitivityDb < 10) {
    return {
      direction: 'down',
      urgency: sensitivityDb <= 5 ? 'warning' : 'hint',
    }
  }

  return { direction: 'none', urgency: 'none' }
}

export function useSensitivityGuidance({
  enabled = true,
  isRunning,
  activeAdvisoryCount,
  sensitivityDb,
}: SensitivityGuidanceParams): FaderGuidance {
  return useMemo(() => deriveSensitivityGuidance({
    enabled,
    isRunning,
    activeAdvisoryCount,
    sensitivityDb,
  }), [enabled, isRunning, activeAdvisoryCount, sensitivityDb])
}
