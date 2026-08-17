/**
 * Registers the Phase P1 service worker (production builds only).
 * Caching policy lives in /sw.js — static assets only.
 */
export function registerMpexServiceWorker(): void {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Fail soft: installability may still work via manifest on some platforms.
    })
  })
}
