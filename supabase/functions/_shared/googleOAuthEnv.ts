import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { resolveAllowedAppReturnUrl } from './googleOAuthAppReturnAllowlist.ts'

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`Missing env: ${name}`)
  }
  return value
}

/**
 * Encryption key ring for dual-key decrypt during rotation.
 * Raw keys stay in Edge secrets only — never in Postgres.
 *
 * GOOGLE_TOKEN_ENCRYPTION_KEY_ID     → active key id (default v1)
 * GOOGLE_TOKEN_ENCRYPTION_KEY        → active key material (base64 32 bytes)
 * GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS_ID → optional decrypt_only id
 * GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS    → optional previous key material
 */
export function getTokenEncryptionKeyRing() {
  const activeKeyId = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY_ID') ?? 'v1'
  const activeKey = requireEnv('GOOGLE_TOKEN_ENCRYPTION_KEY')
  const previousKeyId = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS_ID') ?? null
  const previousKey = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS') ?? null

  if (previousKeyId && !previousKey) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS is required when PREVIOUS_ID is set.')
  }
  if (previousKey && !previousKeyId) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS_ID is required when PREVIOUS key is set.')
  }

  return {
    activeKeyId,
    activeKey,
    previousKeyId,
    previousKey,
  }
}

export function getGoogleOAuthConfig() {
  const configuredReturn = requireEnv('GOOGLE_OAUTH_APP_RETURN_URL')
  // Env alone is insufficient: must match hardcoded allowlist.
  const appReturnBaseUrl = resolveAllowedAppReturnUrl(configuredReturn)

  return {
    ...getGoogleApiCredentials(),
    redirectUri: requireEnv('GOOGLE_OAUTH_REDIRECT_URI'),
    appReturnBaseUrl,
    scopes: (
      Deno.env.get('GOOGLE_OAUTH_SCOPES') ??
      'https://www.googleapis.com/auth/calendar.events'
    )
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

/** Meet provisioner credentials — does not require app return URL allowlist. */
export function getGoogleApiCredentials() {
  return {
    clientId: requireEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
    tokenEncryption: getTokenEncryptionKeyRing(),
  }
}

export function createServiceClient(): SupabaseClient {
  const url = requireEnv('SUPABASE_URL')
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createUserClient(authHeader: string): SupabaseClient {
  const url = requireEnv('SUPABASE_URL')
  const anon = requireEnv('SUPABASE_ANON_KEY')
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return null
  }
  return header
}

export function buildAppReturnRedirect(
  baseUrl: string,
  status: 'connected' | 'error' | 'disconnected',
  errorCode?: string,
): string {
  // Re-validate allowlist at redirect time (defense in depth).
  const allowed = resolveAllowedAppReturnUrl(baseUrl)
  const url = new URL(allowed)
  const params = new URLSearchParams()
  params.set('google-integration', status)
  if (errorCode) {
    params.set('google-integration-error', errorCode)
  }
  url.hash = params.toString()
  return url.toString()
}

/** Best-effort state retention cleanup; never throws to callers. */
export async function runOAuthStateCleanup(service: SupabaseClient): Promise<void> {
  try {
    await service.rpc('meeting_calendar_cleanup_google_oauth_states')
  } catch {
    // Non-fatal: cleanup is opportunistic; scheduled invoke may follow later.
  }
}
