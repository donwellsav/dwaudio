import { describe, expect, it } from 'vitest'
import {
  getPA2StatusDotClass,
  getPA2TooltipText,
} from '@/components/analyzer/headerBarRightControlsUtils'

describe('headerBarRightControlsUtils', () => {
  it('builds PA2 tooltip copy for connected, error, and idle states', () => {
    expect(
      getPA2TooltipText({
        status: 'connected',
        error: null,
        notchSlotsUsed: 2,
        notchSlotsAvailable: 6,
      }),
    ).toBe('PA2 connected - PEQ 2/8 slots')

    expect(
      getPA2TooltipText({
        status: 'error',
        error: 'timeout',
        notchSlotsUsed: 0,
        notchSlotsAvailable: 8,
      }),
    ).toBe('PA2 error: timeout')

    expect(
      getPA2TooltipText({
        status: 'connecting',
        error: null,
        notchSlotsUsed: 0,
        notchSlotsAvailable: 8,
      }),
    ).toBe('PA2 connecting')
  })

  it('maps status labels consistently', () => {
    expect(getPA2StatusDotClass('connected')).toBe('bg-green-500')
    expect(getPA2StatusDotClass('connecting')).toBe(
      'bg-yellow-500 animate-pulse',
    )
    expect(getPA2StatusDotClass('error')).toBe('bg-red-500')
    expect(getPA2StatusDotClass('idle')).toBe('bg-muted-foreground')

  })
})
