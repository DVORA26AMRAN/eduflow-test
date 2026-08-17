/**
 * Installed-app entry (`/app`) — login-first navigation intent.
 *
 * Opening the installed application uses this dedicated start URL so users
 * land on the MPEX login screen (no marketing splash).
 *
 * CRITICAL: do not signOut / clear Supabase session storage when entering.
 * The gate only defers surfacing authenticated UI until an explicit login
 * on this visit; website `/` behavior remains unchanged.
 */

export const INSTALLED_APP_ENTRY_PATH = '/app'

export function normalizeAppPath(pathname: string): string {
  if (!pathname) return '/'
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

export function isInstalledAppEntryPath(pathname: string): boolean {
  return normalizeAppPath(pathname) === INSTALLED_APP_ENTRY_PATH
}

/** True when this document load should prefer the login screen for `/app`. */
export function shouldHoldInstalledAppLoginEntry(
  pathname: string = typeof window !== 'undefined' ? window.location.pathname : '/',
): boolean {
  return isInstalledAppEntryPath(pathname)
}

/**
 * After an explicit login from the installed entry, leave `/app` so a refresh
 * does not re-hold the login gate. Does not touch auth storage.
 */
export function consumeInstalledAppLoginEntry(): void {
  if (typeof window === 'undefined') return
  if (!isInstalledAppEntryPath(window.location.pathname)) return
  window.history.replaceState(window.history.state, '', '/')
}
