/**
 * Detect standalone / installed display mode and iOS Home Screen launch.
 * No secrets; client-only capability detection.
 */

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  const media = window.matchMedia?.('(display-mode: standalone)')
  if (media?.matches) return true
  const iosStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone
  return iosStandalone === true
}

export function isIosLikeDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iOS = /iPad|iPhone|iPod/.test(ua)
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iOS || iPadOs
}
