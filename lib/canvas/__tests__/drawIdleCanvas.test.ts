// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { drawIdleCanvas } from '@/lib/canvas/drawing/drawIdleCanvas'
import { DARK_CANVAS_THEME, calcPadding } from '@/lib/canvas/drawing/canvasTypes'
import { getSensitivityGraphY } from '@/lib/fader/faderMath'

class Path2DStub {
  moveTo = vi.fn()
  lineTo = vi.fn()
  roundRect = vi.fn()
}

vi.stubGlobal('Path2D', Path2DStub)

function createMockCtx() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    font: '',
    textAlign: '' as CanvasTextAlign,
    fillRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    createLinearGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
  } as unknown as CanvasRenderingContext2D
}

describe('drawIdleCanvas', () => {
  it('draws the sensitivity threshold line while the analyzer is idle', () => {
    const ctx = createMockCtx()
    const canvas = {
      width: 900,
      height: 500,
      getContext: vi.fn(() => ctx),
    } as unknown as HTMLCanvasElement

    drawIdleCanvas(canvas, 11, -100, 0, DARK_CANVAS_THEME, {
      showThresholdLine: true,
      feedbackThresholdDb: 32,
    })

    const padding = calcPadding(900, 500)
    const plotWidth = 900 - padding.left - padding.right
    const plotHeight = 500 - padding.top - padding.bottom
    const expectedY = getSensitivityGraphY({ value: 32, plotHeight })

    expect(ctx.lineTo).toHaveBeenCalledWith(plotWidth, expectedY)
    expect(ctx.lineTo).toHaveBeenCalledWith(plotWidth, plotHeight)
  })
})
