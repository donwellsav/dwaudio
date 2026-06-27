import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedbackDetector } from '../feedbackDetector'

type MockTrack = {
  readyState: MediaStreamTrackState
  onended: (() => void) | null
  stop: ReturnType<typeof vi.fn>
}

type MockStream = {
  stream: MediaStream
  track: MockTrack
}

type MockAudioContextInstance = {
  sampleRate: number
  state: AudioContextState
  createAnalyser: ReturnType<typeof vi.fn>
  createMediaStreamSource: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  dispatchStateChange: () => void
}

const createdContexts: MockAudioContextInstance[] = []

function createMockStream(): MockStream {
  const track: MockTrack = {
    readyState: 'live',
    onended: null,
    stop: vi.fn(() => {
      track.readyState = 'ended'
    }),
  }

  return {
    stream: {
      getAudioTracks: vi.fn(() => [track as unknown as MediaStreamTrack]),
      getTracks: vi.fn(() => [track as unknown as MediaStreamTrack]),
    } as unknown as MediaStream,
    track,
  }
}

function createMockAnalyser(): AnalyserNode {
  return {
    frequencyBinCount: 4096,
    fftSize: 8192,
    smoothingTimeConstant: 0,
    minDecibels: -100,
    maxDecibels: 0,
    getFloatFrequencyData: vi.fn(),
    getFloatTimeDomainData: vi.fn(),
  } as unknown as AnalyserNode
}

function createMockAudioContext(): MockAudioContextInstance {
  let onStateChange: (() => void) | null = null
  const context: MockAudioContextInstance = {
    sampleRate: 48_000,
    state: 'running',
    createAnalyser: vi.fn(createMockAnalyser),
    createMediaStreamSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    resume: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn((eventName: string, listener: () => void) => {
      if (eventName === 'statechange') {
        onStateChange = listener
      }
    }),
    removeEventListener: vi.fn((eventName: string, listener: () => void) => {
      if (eventName === 'statechange' && onStateChange === listener) {
        onStateChange = null
      }
    }),
    dispatchStateChange: () => {
      onStateChange?.()
    },
  }

  createdContexts.push(context)
  return context
}

function installBrowserMocks(getUserMedia: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('window', {
    AudioContext: vi.fn(createMockAudioContext),
  })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
}

describe('FeedbackDetector lifecycle', () => {
  beforeEach(() => {
    createdContexts.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('coalesces concurrent starts into one microphone acquisition', async () => {
    const pendingResolves: Array<(stream: MediaStream) => void> = []
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
      pendingResolves.push(resolve)
    }))
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector()
    const firstStart = detector.start()
    const secondStart = detector.start()
    const getUserMediaCalls = getUserMedia.mock.calls.length

    for (const resolve of pendingResolves) {
      resolve(createMockStream().stream)
    }
    await Promise.allSettled([firstStart, secondStart])

    expect(getUserMediaCalls).toBe(1)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
  })

  it('reacquires the microphone after an active track ends', async () => {
    const firstStream = createMockStream()
    const secondStream = createMockStream()
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(firstStream.stream)
      .mockResolvedValueOnce(secondStream.stream)
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector()
    await detector.start()

    firstStream.track.readyState = 'ended'
    firstStream.track.onended?.()
    await detector.start()

    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(createdContexts[0].createMediaStreamSource).toHaveBeenLastCalledWith(secondStream.stream)
  })

  it('creates a fresh audio context after the current context closes', async () => {
    const firstStream = createMockStream()
    const secondStream = createMockStream()
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(firstStream.stream)
      .mockResolvedValueOnce(secondStream.stream)
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector()
    await detector.start()

    createdContexts[0].state = 'closed'
    createdContexts[0].dispatchStateChange()
    await detector.start()

    expect(createdContexts).toHaveLength(2)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })
})
