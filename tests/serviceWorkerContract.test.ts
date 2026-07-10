import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SELF_ORIGIN = 'https://donewell.test'
const CORE_ASSETS = [
  '/',
  '/~offline',
  '/manifest.json',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-icon.png',
]

class WorkerRequest {
  readonly url: string
  readonly cache: RequestCache

  constructor(input: string, init: RequestInit = {}) {
    this.url = new URL(input, SELF_ORIGIN).href
    this.cache = init.cache ?? 'default'
  }
}

function createServiceWorkerHarness() {
  const listeners = new Map<string, (event: unknown) => void>()
  const cachedResponse = { source: 'cache' }
  const networkResponse = {
    clone: vi.fn(() => ({ source: 'network clone' })),
    ok: true,
    source: 'network',
  }
  const cache = {
    add: vi.fn(async (request: WorkerRequest) => void request),
    addAll: vi.fn(async (requests: WorkerRequest[]) => void requests),
    put: vi.fn(async () => undefined),
  }
  const caches = {
    delete: vi.fn(async () => true),
    keys: vi.fn(async () => [] as string[]),
    match: vi.fn(async (): Promise<unknown> => cachedResponse),
    open: vi.fn(async () => cache),
  }
  const fetch = vi.fn(async () => networkResponse)
  const self = {
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener)
    }),
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: SELF_ORIGIN },
    skipWaiting: vi.fn(),
  }

  runInNewContext(
    readFileSync(new URL('../public/dwa-service-worker.js', import.meta.url), 'utf8'),
    {
      caches,
      fetch,
      Request: WorkerRequest,
      Response,
      self,
      URL,
    },
  )

  function listenerFor(type: string) {
    const listener = listeners.get(type)
    expect(listener, `service worker ${type} listener`).toBeTypeOf('function')
    return listener!
  }

  function dispatchInstall(): Promise<unknown> {
    let installation: Promise<unknown> | undefined
    listenerFor('install')({
      waitUntil(value: Promise<unknown>) {
        installation = value
      },
    })
    expect(installation, 'install event waitUntil promise').toBeDefined()
    return installation!
  }

  function dispatchFetch(destination: RequestDestination, mode: RequestMode = 'cors') {
    const respondWith = vi.fn()
    listenerFor('fetch')({
      request: {
        destination,
        method: 'GET',
        mode,
        url: `${SELF_ORIGIN}/_next/static/chunks/dsp-worker.js`,
      },
      respondWith,
    })
    return respondWith
  }

  return {
    cache,
    caches,
    cachedResponse,
    dispatchFetch,
    dispatchInstall,
    fetch,
    networkResponse,
  }
}

describe('offline service worker contract', () => {
  let harness: ReturnType<typeof createServiceWorkerHarness>

  beforeEach(() => {
    harness = createServiceWorkerHarness()
  })

  it('routes worker requests through cacheFirst', async () => {
    const respondWith = harness.dispatchFetch('worker')

    expect(respondWith).toHaveBeenCalledOnce()
    await expect(respondWith.mock.calls[0][0]).resolves.toBe(harness.cachedResponse)
  })

  it('returns a successful worker response when the runtime cache write fails', async () => {
    harness.caches.match.mockResolvedValueOnce(undefined)
    harness.cache.put.mockRejectedValueOnce(new Error('quota exceeded'))

    const respondWith = harness.dispatchFetch('worker')

    expect(respondWith).toHaveBeenCalledOnce()
    await expect(respondWith.mock.calls[0][0]).resolves.toBe(harness.networkResponse)
    expect(harness.fetch).toHaveBeenCalledOnce()
    expect(harness.cache.put).toHaveBeenCalledOnce()
  })

  it('returns a successful navigation response when the runtime cache write fails', async () => {
    harness.caches.match.mockResolvedValue(undefined)
    harness.cache.put.mockRejectedValueOnce(new Error('quota exceeded'))

    const respondWith = harness.dispatchFetch('document', 'navigate')

    expect(respondWith).toHaveBeenCalledOnce()
    await expect(respondWith.mock.calls[0][0]).resolves.toBe(harness.networkResponse)
    expect(harness.fetch).toHaveBeenCalledOnce()
    expect(harness.cache.put).toHaveBeenCalledOnce()
  })

  it('adds every core asset atomically with reload requests', async () => {
    await harness.dispatchInstall()

    expect(harness.cache.addAll).toHaveBeenCalledOnce()
    expect(harness.cache.add).not.toHaveBeenCalled()

    const requests = harness.cache.addAll.mock.calls[0][0]
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(CORE_ASSETS)
    expect(requests.every((request) => request.cache === 'reload')).toBe(true)
  })

  it('rejects installation when the core cache cannot be populated', async () => {
    harness.cache.addAll.mockRejectedValueOnce(new Error('network'))

    await expect(harness.dispatchInstall()).rejects.toThrow('network')
  })
})
