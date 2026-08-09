/**
 * Hardcoded allowlist — loads shared JSON entries (keep parity with frontend).
 * Staging/production: add exact normalized URLs to the JSON only after confirmation.
 */

import entriesJson from './googleOAuthAppReturnAllowlist.entries.json' with { type: 'json' }

export const GOOGLE_OAUTH_APP_RETURN_URL_ALLOWLIST =
  entriesJson as readonly string[]

export function normalizeAppReturnUrl(raw: string): string {
  const url = new URL(raw)
  if (url.username || url.password) {
    throw new Error('App return URL must not include credentials.')
  }
  if (url.search || url.hash) {
    throw new Error('App return URL must not include query or hash.')
  }
  let path = url.pathname || '/'
  if (!path.endsWith('/')) {
    path += '/'
  }
  return `${url.protocol}//${url.host}${path}`
}

export function resolveAllowedAppReturnUrl(configuredEnvUrl: string): string {
  if (!configuredEnvUrl || !configuredEnvUrl.trim()) {
    throw new Error('GOOGLE_OAUTH_APP_RETURN_URL is required.')
  }

  let normalizedConfigured: string
  try {
    normalizedConfigured = normalizeAppReturnUrl(configuredEnvUrl.trim())
  } catch {
    throw new Error('GOOGLE_OAUTH_APP_RETURN_URL is invalid.')
  }

  const matched = GOOGLE_OAUTH_APP_RETURN_URL_ALLOWLIST.find(
    (entry) => normalizeAppReturnUrl(entry) === normalizedConfigured,
  )

  if (!matched) {
    throw new Error(
      'GOOGLE_OAUTH_APP_RETURN_URL is not in the hardcoded allowlist. Update googleOAuthAppReturnAllowlist.entries.json via PR.',
    )
  }

  return normalizeAppReturnUrl(matched)
}
