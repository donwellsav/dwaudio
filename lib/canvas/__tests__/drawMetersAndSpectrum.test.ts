// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { drawLevelGlow, drawLevelMeter } from '@/lib/canvas/drawing/drawMeters'
import {
  drawFreqRangeOverlay,
  drawSpectrum,
} from '@/lib/canvas/drawing/drawSpectrum'
import { DARK_CANVAS_THEME, type DbRange } from '@/lib/canvas/drawing/canvasTypes'
import type { SpectrumData } from '@/types/advisory'

class Path2DStub {
  moveTo = vi.fn()
  lineTo = vi.fn()
  closePath = vi.fn()
  roundRect = vi.fn()
}

vi.stubGlobal('Path2D', Path2DStub)

function createMockGradient() {
  return {
    addColorStop: vi.fn(),
  } as unknown as CanvasGradient
}

function createMockCtx() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    fillRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    createLinearGradient: vi.fn(() => createMockGradient()),
    createRadialGradient: vi.fn(() => createMockGradient()),
  } as unknown as CanvasRenderingContext2D
}

function range(): DbRange {
  return { dbMin: -90, dbMax: 0, freqMin: 20, freqMax: 20000 }
}

function spectrum(overrides: Partial<SpectrumData> = {}): SpectrumData {
  return {
    freqDb: new Float32Array([-90, -80, -30, -20, -70, -60, -50, -40]),
    peak: -20,
    sampleRate: 48_000,
    fftSize: 16,
    timestamp: 1,
    algorithmMode: 'auto',
    contentType: 'unknown',
    msdFrameCount: 0,
    isCompressed: false,
    compressionRatio: 1,
    ...overrides,
  } as SpectrumData
}

describe('meter drawing helpers', () => {
  it('skips level meter and glow work when the input is below visible thresholds', () => {
    const ctx = createMockCtx()

    drawLevelMeter(ctx, 200, range(), spectrum({ peak: -100 }), DARK_CANVAS_THEME)
    drawLevelGlow(ctx, 300, 200, spectrum({ peak: -80 }))

    expect(ctx.fillRect).not.toHaveBeenCalled()
    expect(ctx.createRadialGradient).not.toHaveBeenCalled()
  })

  it('draws level meter fill, background, and peak-hold line for visible signal', () => {
    const ctx = createMockCtx()

    drawLevelMeter(ctx, 200, range(), spectrum({ peak: -12 }), DARK_CANVAS_THEME)

    expect(ctx.createLinearGradient).toHaveBeenCalled()
    expect(ctx.fillRect).toHaveBeenCalledTimes(2)
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
  })

  it('draws blue, amber, and red glow bands for rising signal levels', () => {
    const ctx = createMockCtx()

    drawLevelGlow(ctx, 300, 200, spectrum({ peak: -20 }))
    drawLevelGlow(ctx, 300, 200, spectrum({ peak: -8 }))
    drawLevelGlow(ctx, 300, 200, spectrum({ peak: -1 }))

    expect(ctx.createRadialGradient).toHaveBeenCalledTimes(3)
    expect(ctx.fillRect).toHaveBeenCalledTimes(3)
  })
})

describe('spectrum drawing helpers', () => {
  it('returns without drawing when spectrum data is incomplete', () => {
    const ctx = createMockCtx()

    drawSpectrum(
      ctx,
      300,
      200,
      range(),
      null,
      null,
      { current: null },
      { current: 0 },
      2,
      { current: null },
    )

    expect(ctx.fill).not.toHaveBeenCalled()
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('draws spectrum fill, glow strokes, sharp stroke, and peak-hold trace', () => {
    const ctx = createMockCtx()
    const peakHoldRef = { current: null as Float32Array | null }
    const gradientHeightRef = { current: 0 }

    drawSpectrum(
      ctx,
      300,
      200,
      range(),
      spectrum(),
      new Float32Array([-90, -80, -30, -20, -70, -60, -50, -40]),
      { current: null },
      gradientHeightRef,
      2,
      peakHoldRef,
      true,
    )

    expect(ctx.createLinearGradient).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalledTimes(1)
    expect(ctx.stroke).toHaveBeenCalledTimes(4)
    expect(peakHoldRef.current).toBeInstanceOf(Float32Array)
    expect(gradientHeightRef.current).toBe(-200)
  })

  it('draws the frequency range mask, boundaries, and handles', () => {
    const ctx = createMockCtx()

    drawFreqRangeOverlay(ctx, 300, 200, range(), { min: 80, max: 8000 })

    expect(ctx.fillRect).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalledTimes(2)
    expect(ctx.fill).toHaveBeenCalledTimes(2)
    expect(ctx.globalAlpha).toBe(1)
  })
})
