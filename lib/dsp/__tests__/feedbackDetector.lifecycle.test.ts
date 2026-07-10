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
let deviceChangeListener: (() => void) | null = null

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
      addEventListener: vi.fn((eventName: string, listener: () => void) => {
        if (eventName === 'devicechange') {
          deviceChangeListener = listener
        }
      }),
      removeEventListener: vi.fn((eventName: string, listener: () => void) => {
        if (eventName === 'devicechange' && deviceChangeListener === listener) {
          deviceChangeListener = null
        }
      }),
    },
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
}

describe('FeedbackDetector lifecycle', () => {
  beforeEach(() => {
    createdContexts.length = 0
    deviceChangeListener = null
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

  it('does not start after stop cancels a pending microphone acquisition', async () => {
    const pendingResolves: Array<(stream: MediaStream) => void> = []
    const acquiredStream = createMockStream()
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
      pendingResolves.push(resolve)
    }))
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector()
    const startPromise = detector.start()

    detector.stop({ releaseMic: true })
    for (const resolve of pendingResolves) {
      resolve(acquiredStream.stream)
    }
    await startPromise

    expect(acquiredStream.track.stop).toHaveBeenCalled()
    expect(detector.getState().isRunning).toBe(false)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('releases an acquired microphone and source when AudioContext resume rejects', async () => {
    const pendingResolves: Array<(stream: MediaStream) => void> = []
    const acquiredStream = createMockStream()
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
      pendingResolves.push(resolve)
    }))
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector()
    const startPromise = detector.start()
    const context = createdContexts[0]
    context.state = 'suspended'
    context.resume.mockRejectedValueOnce(new Error('resume failed'))
    for (const resolve of pendingResolves) {
      resolve(acquiredStream.stream)
    }

    await expect(startPromise).rejects.toThrow('resume failed')

    const source = context.createMediaStreamSource.mock.results[0]?.value as {
      disconnect: ReturnType<typeof vi.fn>
    }
    expect(acquiredStream.track.stop).toHaveBeenCalledOnce()
    expect(source.disconnect).toHaveBeenCalledOnce()
    expect(detector.getState().isRunning).toBe(false)
  })

  it('cleans up before a suspended-context callback synchronously restarts', async () => {
    const firstStream = createMockStream()
    const secondStream = createMockStream()
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(firstStream.stream)
      .mockResolvedValueOnce(secondStream.stream)
    const onError = vi.fn()
    let stoppedState: { isRunning: boolean; trackState: MediaStreamTrackState } | null = null
    let restartPromise: Promise<void> | null = null
    const onStopped = vi.fn(() => {
      stoppedState = {
        isRunning: detector.getState().isRunning,
        trackState: firstStream.track.readyState,
      }
      restartPromise = detector.start()
    })
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector({}, { onError, onStopped })
    await detector.start()

    const context = createdContexts[0]
    context.state = 'suspended'
    context.resume
      .mockRejectedValueOnce(new Error('gesture required'))
      .mockImplementationOnce(async () => {
        context.state = 'running'
      })
    context.dispatchStateChange()
    await Promise.resolve()
    await restartPromise

    const message = 'Audio context suspended — could not resume. Try restarting.'
    expect(stoppedState).toEqual({ isRunning: false, trackState: 'ended' })
    expect(detector.getState().isRunning).toBe(true)
    expect(firstStream.track.stop).toHaveBeenCalledOnce()
    expect(secondStream.track.stop).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(message)
    expect(onStopped).toHaveBeenCalledWith(message)
  })

  it('ignores a stale resume rejection after a newer run starts on the same context', async () => {
    const firstStream = createMockStream()
    const secondStream = createMockStream()
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(firstStream.stream)
      .mockResolvedValueOnce(secondStream.stream)
    const onError = vi.fn()
    const onStopped = vi.fn()
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector({}, { onError, onStopped })
    await detector.start()

    const context = createdContexts[0]
    let rejectOldResume!: (error: Error) => void
    context.resume.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectOldResume = reject
    }))
    context.state = 'suspended'
    context.dispatchStateChange()

    detector.stop({ releaseMic: true })
    context.resume.mockImplementationOnce(async () => {
      context.state = 'running'
    })
    await detector.start()
    expect(createdContexts).toHaveLength(1)
    expect(detector.getState().isRunning).toBe(true)

    rejectOldResume(new Error('old resume failed'))
    await Promise.resolve()

    expect(detector.getState().isRunning).toBe(true)
    expect(firstStream.track.stop).toHaveBeenCalledOnce()
    expect(secondStream.track.stop).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(onStopped).not.toHaveBeenCalled()
  })

  it('cleans up before a track-ended callback synchronously restarts', async () => {
    const firstStream = createMockStream()
    const secondStream = createMockStream()
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(firstStream.stream)
      .mockResolvedValueOnce(secondStream.stream)
    let stoppedState: { isRunning: boolean; trackState: MediaStreamTrackState } | null = null
    let restartPromise: Promise<void> | null = null
    const onStopped = vi.fn(() => {
      stoppedState = {
        isRunning: detector.getState().isRunning,
        trackState: firstStream.track.readyState,
      }
      restartPromise = detector.start()
    })
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector({}, { onStopped })
    await detector.start()

    firstStream.track.readyState = 'ended'
    firstStream.track.onended?.()
    await restartPromise

    expect(stoppedState).toEqual({ isRunning: false, trackState: 'ended' })
    expect(detector.getState().isRunning).toBe(true)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(createdContexts[0].createMediaStreamSource).toHaveBeenLastCalledWith(secondStream.stream)
  })

  it('cleans up an ended track before a shutdown callback throws', async () => {
    const acquiredStream = createMockStream()
    const getUserMedia = vi.fn().mockResolvedValue(acquiredStream.stream)
    const onStopped = vi.fn(() => {
      throw new Error('callback failed')
    })
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector({}, { onStopped })
    await detector.start()

    acquiredStream.track.readyState = 'ended'
    expect(() => acquiredStream.track.onended?.()).toThrow('callback failed')

    expect(detector.getState().isRunning).toBe(false)
    expect(acquiredStream.track.stop).toHaveBeenCalledOnce()
  })

  it('cleans up before a devicechange callback synchronously restarts', async () => {
    const firstStream = createMockStream()
    const secondStream = createMockStream()
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(firstStream.stream)
      .mockResolvedValueOnce(secondStream.stream)
    let stoppedState: { isRunning: boolean; trackState: MediaStreamTrackState } | null = null
    let restartPromise: Promise<void> | null = null
    const onStopped = vi.fn(() => {
      stoppedState = {
        isRunning: detector.getState().isRunning,
        trackState: firstStream.track.readyState,
      }
      restartPromise = detector.start()
    })
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector({}, { onStopped })
    await detector.start()

    firstStream.track.readyState = 'ended'
    deviceChangeListener?.()
    await restartPromise

    expect(stoppedState).toEqual({ isRunning: false, trackState: 'ended' })
    expect(detector.getState().isRunning).toBe(true)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(createdContexts[0].createMediaStreamSource).toHaveBeenLastCalledWith(secondStream.stream)
  })

  it('cleans up before a closed-context callback synchronously restarts', async () => {
    const firstStream = createMockStream()
    const secondStream = createMockStream()
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(firstStream.stream)
      .mockResolvedValueOnce(secondStream.stream)
    let stoppedState: { isRunning: boolean; trackState: MediaStreamTrackState } | null = null
    let restartPromise: Promise<void> | null = null
    const onStopped = vi.fn(() => {
      stoppedState = {
        isRunning: detector.getState().isRunning,
        trackState: firstStream.track.readyState,
      }
      restartPromise = detector.start()
    })
    installBrowserMocks(getUserMedia)

    const detector = new FeedbackDetector({}, { onStopped })
    await detector.start()

    createdContexts[0].state = 'closed'
    createdContexts[0].dispatchStateChange()
    await restartPromise

    expect(stoppedState).toEqual({ isRunning: false, trackState: 'ended' })
    expect(detector.getState().isRunning).toBe(true)
    expect(createdContexts).toHaveLength(2)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(secondStream.track.stop).not.toHaveBeenCalled()
  })
})
