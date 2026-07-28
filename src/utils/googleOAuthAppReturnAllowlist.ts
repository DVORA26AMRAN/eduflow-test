/**
 * Hardcoded allowlist for post-OAuth SPA return bases.
 * Source of truth: supabase/functions/_shared/googleOAuthAppReturnAllowlist.entries.json
 * (mirrored at config/googleOAuthAppReturnAllowlist.entries.json — parity-tested).
 *
 * Staging / production origins: add the exact normalized URL to BOTH JSON files
 * after the staging frontend URL is confirmed. No wildcards / preview URLs.
 */

import entriesJson from '../../supabase/functions/_shared/googleOAuthAppReturnAllowlist.entries.json'

export const GOOGLE_OAUTH_APP_RETURN_URL_ALLOWLIST =
  entriesJson as readonly string[]

export type GoogleOAuthAppReturnAllowlistEntry =
  (typeof GOOGLE_OAUTH_APP_RETURN_URL_ALLOWLIST)[number]

/** Normalize for exact allowlist comparison (origin + pathname, trailing slash, no hash/search). */
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

/**
 * Rejects any return URL not on the hardcoded allowlist.
 * Env value is only accepted when it matches an allowlisted entry.
 */
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

export function isAppReturnUrlAllowlisted(candidate: string): boolean {
  try {
    resolveAllowedAppReturnUrl(candidate)
    return true
  } catch {
    return false
  }
}
