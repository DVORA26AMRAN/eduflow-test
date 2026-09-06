/**
 * MPEX application origin resolution for Edge-generated user links.
 *
 * Production runtime is detected from SUPABASE_URL host
 * (kkafmsvntwqweudallty.supabase.co) — never from APP_URL itself.
 *
 * Production APP origin must be exactly https://mpex.school (fail closed).
 * Local/dev (non-production Supabase URL) may use http://localhost or 127.0.0.1 / ::1.
 */

export const MPEX_PRODUCTION_APP_ORIGIN = 'https://mpex.school'

/** Hosted MPEX / eduflow Supabase project API host. */
export const MPEX_PRODUCTION_SUPABASE_HOST = 'kkafmsvntwqweudallty.supabase.co'

export function isMpexProductionSupabaseUrl(supabaseUrl: string | null | undefined): boolean {
  if (!supabaseUrl?.trim()) return false
  try {
    const hostname = new URL(supabaseUrl.trim()).hostname.toLowerCase()
    return hostname === MPEX_PRODUCTION_SUPABASE_HOST
  } catch {
    return false
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/**
 * Resolve and validate the public app origin used for Auth redirects / email CTAs.
 * Returns protocol://host only (no path/query/hash).
 *
 * @throws Error with safe message (no secret values) when configuration is invalid.
 */
export function resolveMpexAppOrigin(params: {
  /** First configured value among APP_URL / EDUFLOW_APP_URL / SITE_URL */
  configuredAppUrl: string | null | undefined
  /** Platform SUPABASE_URL — used only as production/runtime signal */
  supabaseUrl: string | null | undefined
}): string {
  const raw = (params.configuredAppUrl ?? '').trim().replace(/\/+$/, '')
  if (!raw) {
    throw new Error('Missing env: APP_URL (or EDUFLOW_APP_URL / SITE_URL)')
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Invalid APP_URL: must be an absolute URL')
  }

  if (parsed.username || parsed.password) {
    throw new Error('Invalid APP_URL: must not include credentials')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('APP_URL must use http or https')
  }

  const origin = `${parsed.protocol}//${parsed.host}`
  const productionRuntime = isMpexProductionSupabaseUrl(params.supabaseUrl)

  if (productionRuntime) {
    if (origin !== MPEX_PRODUCTION_APP_ORIGIN) {
      throw new Error(
        'Invalid APP_URL for production: must be exactly https://mpex.school',
      )
    }
    return MPEX_PRODUCTION_APP_ORIGIN
  }

  // Non-production (e.g. local Supabase): loopback only.
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(
      'Invalid APP_URL for local development: hostname must be localhost, 127.0.0.1, or ::1',
    )
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('APP_URL must use http or https')
  }

  return origin
}

/** Pick first non-empty among standard Edge app URL secrets. */
export function pickConfiguredAppUrl(envGet: (name: string) => string | undefined): string {
  return (
    envGet('APP_URL')?.trim() ||
    envGet('EDUFLOW_APP_URL')?.trim() ||
    envGet('SITE_URL')?.trim() ||
    ''
  )
}
