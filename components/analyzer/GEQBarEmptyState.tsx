'use client'

import { memo } from 'react'
import type { SpectrumStatus } from '@/hooks/audioAnalyzerTypes'

interface GEQBarEmptyStateProps {
  isRunning: boolean
  isLowSignal?: boolean
  spectrumStatus?: SpectrumStatus | null
}

export function getGEQEmptyStateLabel({
  isRunning,
  isLowSignal = false,
  spectrumStatus,
}: GEQBarEmptyStateProps): string {
  if (!isRunning) return 'Engage to see EQ cuts'
  if (isLowSignal || spectrumStatus?.isSignalPresent === false) return 'Waiting for usable signal'
  if (spectrumStatus?.contentType === 'music') return 'Music guard active'
  if (spectrumStatus?.contentType === 'compressed' || spectrumStatus?.isCompressed) {
    return 'Compression guard active'
  }

  return 'No active EQ cuts'
}

export const GEQBarEmptyState = memo(function GEQBarEmptyState({
  isRunning,
  isLowSignal,
  spectrumStatus,
}: GEQBarEmptyStateProps) {
  const label = getGEQEmptyStateLabel({ isRunning, isLowSignal, spectrumStatus })

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-1">
      <span className="font-mono text-xs text-muted-foreground/50 tracking-wide text-center px-4">
        {label}
      </span>
    </div>
  )
})
