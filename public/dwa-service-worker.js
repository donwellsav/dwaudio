const CACHE_VERSION = 'dwaudio-local-v0.121.0'
const CORE_CACHE = `${CACHE_VERSION}-core`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`
const KNOWN_CACHES = new Set([CORE_CACHE, RUNTIME_CACHE])

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

const STATIC_DESTINATIONS = new Set(['script', 'style', 'font', 'image', 'manifest'])

async function cacheCoreAssets() {
  const cache = await caches.open(CORE_CACHE)

  await Promise.all(
    CORE_ASSETS.map(async (asset) => {
      try {
        await cache.add(new Request(asset, { cache: 'reload' }))
      } catch {
        // Offline support is best-effort until the app has completed one load.
      }
    }),
  )
}

async function deleteOldCaches() {
  const keys = await caches.keys()
  await Promise.all(
    keys
      .filter((key) => !KNOWN_CACHES.has(key))
      .filter((key) => (
        key.startsWith('dwaudio-') ||
        key.startsWith('static-assets-') ||
        key.startsWith('serwist-') ||
        key.startsWith('workbox-')
      ))
      .map((key) => caches.delete(key)),
  )
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE)
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    const cachedRequest = await caches.match(request)
    const cachedRoot = await caches.match('/')
    const offline = await caches.match('/~offline')

    return cachedRequest || cachedRoot || offline || new Response('DoneWell Audio is offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(cacheCoreAssets())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    deleteOldCaches().then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(cacheFirst(request))
  }
})
