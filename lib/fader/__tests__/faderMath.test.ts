import { describe, expect, it } from 'vitest'
import {
  clampFaderValue,
  getFaderBounds,
  getFaderThumbBottom,
  getFaderValueFromClientY,
  getSensitivityGraphDragValue,
  getSensitivityGraphY,
  stepFaderValue,
} from '@/lib/fader/faderMath'

describe('faderMath', () => {
  it('uses fixed sensitivity bounds regardless of caller min and max', () => {
    expect(getFaderBounds({ mode: 'sensitivity', min: -40, max: 40 })).toEqual({
      min: 2,
      max: 50,
    })
  })

  it('maps the top of the sensitivity track to the most sensitive value', () => {
    expect(getFaderValueFromClientY({
      mode: 'sensitivity',
      clientY: 0,
      trackTop: 0,
      trackHeight: 120,
      min: 2,
      max: 50,
    })).toBe(2)
  })

  it('maps the bottom of the gain track to the minimum value', () => {
    expect(getFaderValueFromClientY({
      mode: 'gain',
      clientY: 120,
      trackTop: 0,
      trackHeight: 120,
      min: -40,
      max: 40,
    })).toBe(-40)
  })

  it('steps sensitivity in the opposite direction from gain', () => {
    expect(stepFaderValue({
      mode: 'sensitivity',
      value: 20,
      direction: 1,
      min: 2,
      max: 50,
    })).toBe(19)

    expect(stepFaderValue({
      mode: 'gain',
      value: 0,
      direction: 1,
      min: -40,
      max: 40,
    })).toBe(1)
  })

  it('calculates thumb position for sensitivity from the inverted scale', () => {
    expect(getFaderThumbBottom({
      mode: 'sensitivity',
      value: 50,
      min: 2,
      max: 50,
    })).toBe(0)

    expect(getFaderThumbBottom({
      mode: 'sensitivity',
      value: 2,
      min: 2,
      max: 50,
    })).toBe(100)
  })

  it('maps the graph sensitivity line opposite the fader visual direction', () => {
    expect(getSensitivityGraphY({
      value: 2,
      plotHeight: 480,
    })).toBe(480)

    expect(getSensitivityGraphY({
      value: 50,
      plotHeight: 480,
    })).toBe(0)
  })

  it('preserves graph drag direction so dragging down lowers dB sensitivity', () => {
    expect(getSensitivityGraphDragValue({
      startValue: 20,
      startY: 100,
      currentY: 148,
      plotHeight: 480,
    })).toBe(15)

    expect(getSensitivityGraphDragValue({
      startValue: 20,
      startY: 100,
      currentY: 52,
      plotHeight: 480,
    })).toBe(25)
  })

  it('clamps edited values to the configured range', () => {
    expect(clampFaderValue({
      mode: 'gain',
      value: 99,
      min: -40,
      max: 40,
    })).toBe(40)
  })
})
