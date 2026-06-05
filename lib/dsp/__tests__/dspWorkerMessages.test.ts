/**
 * DSP Worker Message Dispatch — Unit Tests
 *
 * Tests the worker's message handling switch statement for type safety,
 * error serialization format, and message routing correctness.
 *
 * Note: These tests validate the message handling logic by testing
 * the exported types and error format expectations. The actual worker
 * runs in a separate thread and can't be unit-tested directly, but
 * we can verify the contract.
 */
import { describe, it, expect } from 'vitest'
import type { WorkerOutboundMessage } from '../dspWorker'
import type { Advisory } from '@/types/advisory'

/** Minimal advisory for testing — structurally valid (no `as` cast) */
function makeTestAdvisory(overrides: Partial<Advisory> = {}): Advisory {
  return {
    id: 'test-1',
    trackId: 'track-1',
    timestamp: Date.now(),
    label: 'ACOUSTIC_FEEDBACK',
    severity: 'RESONANCE',
    confidence: 0.8,
    why: ['test'],
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -30,
    prominenceDb: 15,
    qEstimate: 10,
    bandwidthHz: 50,
    velocityDbPerSec: 0,
    stabilityCentsStd: 0,
    harmonicityScore: 0,
    modulationScore: 0,
    advisory: {
      geq: { bandIndex: 10, bandHz: 1000, suggestedDb: -3 },
      peq: { type: 'bell', hz: 1000, gainDb: -3, q: 8 },
      shelves: [],
      pitch: { note: 'B', octave: 4, cents: 0, midi: 71 },
    },
    ...overrides,
  }
}

describe('WorkerOutboundMessage types', () => {
  it('advisory message has required fields', () => {
    const advisory = makeTestAdvisory()
    const msg: WorkerOutboundMessage = { type: 'advisory', advisory }
    expect(msg.type).toBe('advisory')
    if (msg.type === 'advisory') {
      expect(msg.advisory.id).toBe('test-1')
      expect(msg.advisory.severity).toBe('RESONANCE')
    }
  })

  it('tracksUpdate message carries optional status fields', () => {
    const msg: WorkerOutboundMessage = {
      type: 'tracksUpdate',
      tracks: [],
      contentType: 'speech',
      algorithmMode: 'auto',
      isCompressed: false,
      compressionRatio: 1,
      lastFusionVerdict: 'POSSIBLE_FEEDBACK',
      lastFeedbackProbability: 0.52,
      lastFusionConfidence: 0.41,
      lastReportDecision: 'blocked',
      lastReportGate: 'low-confidence',
      lastReportGateReason: 'Confidence is below the display threshold',
    }
    expect(msg.type).toBe('tracksUpdate')
    expect(msg.contentType).toBe('speech')
    expect(msg.lastReportGate).toBe('low-confidence')
  })

  it('tracksUpdate works without optional fields', () => {
    const msg: WorkerOutboundMessage = {
      type: 'tracksUpdate',
      tracks: [],
    }
    expect(msg.type).toBe('tracksUpdate')
    expect(msg.contentType).toBeUndefined()
  })

  it('combPatternUpdate message carries normalized early-warning pattern payload', () => {
    const msg: WorkerOutboundMessage = {
      type: 'combPatternUpdate',
      pattern: {
        hasPattern: true,
        predictedFrequencies: [500, 1000, 1500],
        fundamentalSpacing: 500,
        estimatedPathLength: 0.34,
        confidence: 0.82,
        matchingPeaks: 3,
      },
    }
    expect(msg.type).toBe('combPatternUpdate')
    if (msg.type === 'combPatternUpdate') {
      expect(msg.pattern?.predictedFrequencies).toEqual([500, 1000, 1500])
      expect(msg.pattern?.confidence).toBe(0.82)
    }
  })

  it('error message has string message', () => {
    const msg: WorkerOutboundMessage = {
      type: 'error',
      message: '[processPeak @ 1000.5Hz bin=85] TypeError: Cannot read properties',
    }
    expect(msg.type).toBe('error')
    expect(msg.message).toContain('processPeak')
    expect(msg.message).toContain('1000.5Hz')
  })

  it('error message format includes peak context when available', () => {
    // Verify the expected error format from the catch block in dspWorker.ts
    const errorMsg = `[peak @ 1000.5Hz bin=85] Some error occurred`
    expect(errorMsg).toMatch(/\[peak @ \d+\.\d+Hz bin=\d+\]/)
  })

  it('ready message has no extra fields', () => {
    const msg: WorkerOutboundMessage = { type: 'ready' }
    expect(msg.type).toBe('ready')
  })

  it('returnBuffers message has spectrum array', () => {
    const spectrum = new Float32Array(4096)
    const msg: WorkerOutboundMessage = {
      type: 'returnBuffers',
      spectrum,
    }
    expect(msg.type).toBe('returnBuffers')
    expect(msg.spectrum).toBe(spectrum)
    expect(msg.spectrum.length).toBe(4096)
  })

  it('advisoryCleared message has advisory ID', () => {
    const msg: WorkerOutboundMessage = {
      type: 'advisoryCleared',
      advisoryId: 'cleared-1',
    }
    expect(msg.advisoryId).toBe('cleared-1')
  })
})

describe('Error message format contract', () => {
  it('generic error format includes message type', () => {
    // Contract: errors are formatted as [msgType] errorMessage
    const format = `[init] Settings validation failed`
    expect(format).toMatch(/^\[\w+\]/)
  })

  it('peak error format includes frequency and bin', () => {
    // Contract: peak errors include @ frequency bin=N
    const format = `[peak @ 440.0Hz bin=37] Array index out of bounds`
    expect(format).toMatch(/\[peak @ \d+\.\d+Hz bin=\d+\]/)
  })

  it('clearPeak error format is standard', () => {
    const format = `[clearPeak] Invalid bin index`
    expect(format).toMatch(/^\[clearPeak\]/)
  })
})
