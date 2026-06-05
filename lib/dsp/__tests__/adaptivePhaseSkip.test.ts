import { describe, it, expect } from 'vitest'
import { AlgorithmEngine } from '../workerFft'

describe('Adaptive Phase Skip', () => {
  function makeEngine(fusedProb = 0.5): AlgorithmEngine {
    const engine = new AlgorithmEngine()
    engine.updateLastFusion(fusedProb)
    return engine
  }

  it('never skips when disabled', () => {
    const engine = makeEngine(0.95)
    expect(engine.shouldSkipPhase(false, 'speech')).toBe(false)
  })

  it('never skips in liveMusic mode', () => {
    const engine = makeEngine(0.95)
    expect(engine.shouldSkipPhase(true, 'liveMusic')).toBe(false)
  })

  it('never skips in worship mode', () => {
    const engine = makeEngine(0.95)
    expect(engine.shouldSkipPhase(true, 'worship')).toBe(false)
  })

  it('never skips when MSD is undecided (mid-range prob)', () => {
    const engine = makeEngine(0.5)
    expect(engine.shouldSkipPhase(true, 'speech')).toBe(false)
  })

  it('skips in speech mode when MSD is decisive (high prob) — 1-in-3 cadence', () => {
    const engine = makeEngine(0.95)
    const results: boolean[] = []
    for (let i = 0; i < 6; i++) {
      results.push(engine.shouldSkipPhase(true, 'speech'))
      // Simulate feedFrame incrementing counter
      ;(engine as unknown as { _phaseFrameCounter: number })._phaseFrameCounter++
    }
    // Pattern: run, skip, skip, run, skip, skip
    expect(results).toEqual([false, true, true, false, true, true])
  })

  it('skips when MSD is decisive low (clearly not feedback)', () => {
    const engine = makeEngine(0.05)
    ;(engine as unknown as { _phaseFrameCounter: number })._phaseFrameCounter = 1
    expect(engine.shouldSkipPhase(true, 'speech')).toBe(true)
  })

  it('skips in monitors mode when decisive', () => {
    const engine = makeEngine(0.95)
    ;(engine as unknown as { _phaseFrameCounter: number })._phaseFrameCounter = 2
    expect(engine.shouldSkipPhase(true, 'monitors')).toBe(true)
  })

  it('skips in broadcast mode when decisive', () => {
    const engine = makeEngine(0.95)
    ;(engine as unknown as { _phaseFrameCounter: number })._phaseFrameCounter = 1
    expect(engine.shouldSkipPhase(true, 'broadcast')).toBe(true)
  })

  it('does not skip at boundary values (prob exactly 0.8 or 0.1)', () => {
    // Boundary: 0.8 is NOT > 0.8, so should not skip
    const engine08 = makeEngine(0.8)
    ;(engine08 as unknown as { _phaseFrameCounter: number })._phaseFrameCounter = 1
    expect(engine08.shouldSkipPhase(true, 'speech')).toBe(false)

    // Boundary: 0.1 is NOT < 0.1, so should not skip
    const engine01 = makeEngine(0.1)
    ;(engine01 as unknown as { _phaseFrameCounter: number })._phaseFrameCounter = 1
    expect(engine01.shouldSkipPhase(true, 'speech')).toBe(false)
  })
})
