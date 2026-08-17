/* MPEX Phase P1 — minimum service worker
 *
 * Cache ONLY versioned hashed/static assets (icons, manifest, /assets/*).
 * NEVER cache HTML navigations / index.html (avoids pinning installed users
 * to a stale shell after deploy).
 * NEVER cache Supabase API, auth/session, or tenant/business data.
 */
const CACHE_VERSION = 'mpex-static-v2'
const STATIC_CACHE = CACHE_VERSION

const PRECACHE_URLS = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/icons/favicon-48.png',
]

function isSensitiveRequest(url) {
  const href = url.href
  const host = url.hostname
  // Supabase project APIs / auth / realtime / storage
  if (host.endsWith('.supabase.co')) return true
  if (href.includes('/auth/v1')) return true
  if (href.includes('/rest/v1')) return true
  if (href.includes('/storage/v1')) return true
  if (href.includes('/realtime/v1')) return true
  if (href.includes('/functions/v1')) return true
  // Any explicit API-ish path on same origin
  if (url.pathname.startsWith('/api/')) return true
  return false
}

function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false
  if (isSensitiveRequest(url)) return false
  const p = url.pathname
  if (p.startsWith('/icons/')) return true
  if (p === '/manifest.webmanifest') return true
  if (p === '/sw.js') return false
  // Vite hashed build assets
  if (p.startsWith('/assets/')) return true
  return false
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE) return caches.delete(key)
          return undefined
        }),
      ),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // Network-only for all sensitive / dynamic / non-static traffic
  if (isSensitiveRequest(url) || request.headers.get('Authorization')) {
    return
  }

  // Navigations / HTML (including / and /app → index.html): always network.
  // Do not cache index.html so deployed builds are not pinned indefinitely.
  if (request.mode === 'navigate' || request.destination === 'document') {
    return
  }

  if (!isStaticAsset(url)) {
    return
  }

  // Static assets: stale-while-revalidate with versioned cache name
  // (bump CACHE_VERSION when changing SW policy).
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request)
      const networkPromise = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            void cache.put(request, response.clone())
          }
          return response
        })
        .catch(() => cached)
      return cached || networkPromise
    }),
  )
})
