import { describe, expect, it } from 'vitest'
import { formatSpectrumStatusDescription } from '@/components/analyzer/spectrumCanvasStatus'

describe('formatSpectrumStatusDescription', () => {
  const base = {
    minFrequency: 150,
    maxFrequency: 10000,
    rtaDbMin: -100,
    rtaDbMax: 0,
    isFrozen: false,
    isKeyboardInteractive: false,
    canAdjustFrequency: false,
    canAdjustThreshold: false,
  }

  it('reports active detections when unresolved advisories exist', () => {
    expect(formatSpectrumStatusDescription({
      ...base,
      isRunning: true,
      activeAdvisoryCount: 2,
      totalAdvisoryCount: 2,
    })).toContain('2 active feedback detections')
  })

  it('distinguishes cleared issue cards from active detections', () => {
    const description = formatSpectrumStatusDescription({
      ...base,
      isRunning: true,
      activeAdvisoryCount: 0,
      totalAdvisoryCount: 1,
    })

    expect(description).toContain('No active feedback detections.')
    expect(description).toContain('Cleared issues may remain')
    expect(description).not.toContain('0 active feedback detections')
  })

  it('uses the stopped analyzer message when not running', () => {
    expect(formatSpectrumStatusDescription({
      ...base,
      isRunning: false,
      activeAdvisoryCount: 0,
      totalAdvisoryCount: 0,
    })).toBe('Spectrum analyzer stopped. Press Enter or click Start to begin analysis.')
  })

  it('reports only the keyboard controls that are actually wired', () => {
    expect(formatSpectrumStatusDescription({
      ...base,
      isRunning: true,
      activeAdvisoryCount: 0,
      totalAdvisoryCount: 0,
      isKeyboardInteractive: true,
      canAdjustThreshold: true,
    })).toContain('Keyboard: Up and Down arrows adjust threshold. Hold Shift for larger steps.')

    expect(formatSpectrumStatusDescription({
      ...base,
      isRunning: true,
      activeAdvisoryCount: 0,
      totalAdvisoryCount: 0,
      isKeyboardInteractive: true,
      canAdjustFrequency: true,
    })).toContain('Keyboard: Left and Right arrows adjust frequency range. Hold Shift for larger steps.')
  })
})
