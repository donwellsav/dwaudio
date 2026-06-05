import { describe, expect, it, vi } from 'vitest'
import {
  createGEQCanvasMetrics,
  drawGEQBarView,
} from '@/lib/canvas/geqBarViewDrawing'
import type { BandRecommendation } from '@/lib/canvas/geqBarViewShared'

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
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    shadowColor: '',
    shadowBlur: 0,
    fillRect: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fill: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    roundRect: vi.fn(),
    createRadialGradient: vi.fn(() => createMockGradient()),
  } as unknown as CanvasRenderingContext2D
}

describe('drawGEQBarView', () => {
  it('does not draw synthetic bars when there are no recommendations', () => {
    const ctx = createMockCtx()
    const metrics = createGEQCanvasMetrics(620, 240, 11)

    drawGEQBarView(ctx, metrics, new Map(), true)

    expect(ctx.roundRect).not.toHaveBeenCalled()
  })

  it('draws bars only for real band recommendations', () => {
    const ctx = createMockCtx()
    const metrics = createGEQCanvasMetrics(620, 240, 11)
    const recommendations = new Map<number, BandRecommendation>([
      [17, {
        suggestedDb: -6,
        color: '#ffb020',
        freq: 1000,
        clusterCount: 1,
      }],
    ])

    drawGEQBarView(ctx, metrics, recommendations, true)

    expect(ctx.roundRect).toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalledWith(
      '-6',
      expect.any(Number),
      expect.any(Number),
    )
  })
})
