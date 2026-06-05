interface SpectrumStatusDescriptionParams {
  isRunning: boolean
  minFrequency: number
  maxFrequency: number
  rtaDbMin: number
  rtaDbMax: number
  activeAdvisoryCount: number
  totalAdvisoryCount: number
  isFrozen: boolean
  isKeyboardInteractive: boolean
  canAdjustThreshold: boolean
}

export function formatSpectrumStatusDescription({
  isRunning,
  minFrequency,
  maxFrequency,
  rtaDbMin,
  rtaDbMax,
  activeAdvisoryCount,
  totalAdvisoryCount,
  isFrozen,
  isKeyboardInteractive,
  canAdjustThreshold,
}: SpectrumStatusDescriptionParams): string {
  if (!isRunning) {
    return 'Spectrum analyzer stopped. Press Enter or click Start to begin analysis.'
  }

  let description = `Spectrum analyzer active. Displaying frequencies from ${minFrequency} Hz to ${maxFrequency} Hz, ${rtaDbMin} to ${rtaDbMax} dB range.`

  if (activeAdvisoryCount > 0) {
    description += ` ${activeAdvisoryCount} active feedback ${activeAdvisoryCount === 1 ? 'detection' : 'detections'}. Use the Issues panel for details and EQ recommendations.`
  } else if (totalAdvisoryCount > 0) {
    description += ' No active feedback detections. Cleared issues may remain in the Issues panel briefly.'
  } else {
    description += ' No feedback detected.'
  }

  if (isFrozen) {
    description += ' Display is frozen.'
  }

  if (isKeyboardInteractive) {
    description += ` Keyboard: Left and Right arrows adjust frequency range${canAdjustThreshold ? '; Up and Down arrows adjust threshold' : ''}. Hold Shift for larger steps.`
  }

  return description
}
