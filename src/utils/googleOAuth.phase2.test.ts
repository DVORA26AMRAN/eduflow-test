import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  canStartGoogleOAuth,
  decryptRefreshToken,
  encryptRefreshToken,
  generateOAuthStateToken,
  hashOAuthStateToken,
  importAesGcmKeyFromBase64,
  redactSecretsForLog,
  resolveGoogleConnectionUiStatus,
} from './googleOAuthCrypto'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250729110000_meeting_calendar_google_oauth_phase2.sql',
)

describe('Google OAuth Phase 2 migration — auth + state + token rules', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('gates OAuth actor to active manager/secretary only', () => {
    expect(sql).toContain('meeting_calendar_get_google_oauth_actor')
    expect(sql).toContain("'institution_manager', 'secretary'")
    expect(sql).toContain("v_status IS DISTINCT FROM 'active'")
    expect(sql).toContain('Institution mismatch')
  })

  it('rejects teacher implicitly by role allow-list', () => {
    expect(sql).not.toContain("'teacher'")
    expect(sql).toContain("v_role NOT IN ('institution_manager', 'secretary')")
  })

  it('creates one-time OAuth state with user, institution, expiry, redirect URI', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.google_oauth_states')
    expect(sql).toContain('state_token_hash')
    expect(sql).toContain('code_verifier')
    expect(sql).toContain('redirect_uri')
    expect(sql).toContain('expires_at')
    expect(sql).toContain('consumed_at')
    expect(sql).toContain('meeting_calendar_service_create_oauth_state')
    expect(sql).toContain('meeting_calendar_service_consume_oauth_state')
    expect(sql).toContain('OAuth state already used')
    expect(sql).toContain('OAuth state expired')
    expect(sql).toContain('Invalid OAuth state')
    expect(sql).toContain('Redirect URI mismatch')
  })

  it('locks OAuth state and secret RPCs to service_role', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.meeting_calendar_service_create_oauth_state',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.meeting_calendar_service_consume_oauth_state(TEXT, TEXT) FROM authenticated',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.meeting_calendar_service_get_google_refresh_secret(UUID) FROM authenticated',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_get_google_refresh_secret(UUID) TO service_role',
    )
  })

  it('preserves refresh token when Google omits a new one on reconnection', () => {
    expect(sql).toContain('p_has_new_refresh_token')
    expect(sql).toContain('no prior token to preserve')
    expect(sql).toContain("'preserved_refresh_token'")
    expect(sql).toContain('v_cipher := v_existing.refresh_token_ciphertext')
  })

  it('status returns only connection_status and email', () => {
    const idx = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.meeting_calendar_get_google_connection_status',
    )
    const body = sql.slice(
      idx,
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION public.meeting_calendar_service_create_oauth_state',
        idx,
      ),
    )
    expect(body).toContain("'connection_status'")
    expect(body).toContain("'email'")
    expect(body).toContain("'reauthorization_required'")
    expect(body).not.toMatch(/jsonb_build_object\([^)]*refresh_token/)
    expect(body).not.toMatch(/jsonb_build_object\([^)]*ciphertext/)
  })

  it('disconnect clears encrypted credentials and marks revoked', () => {
    expect(sql).toContain('authorization_status = \'revoked\'')
    expect(sql).toContain('refresh_token_ciphertext = NULL')
    expect(sql).toContain('refresh_token_nonce = NULL')
    expect(sql).toContain('reauthorization_required')
  })

  it('denies authenticated access to oauth state table', () => {
    expect(sql).toContain('REVOKE ALL ON TABLE public.google_oauth_states FROM authenticated')
  })
})

describe('Google OAuth authorization policy (client mirror)', () => {
  it('allows active manager and secretary only', () => {
    expect(
      canStartGoogleOAuth({
        role: 'institution_manager',
        status: 'active',
        institutionId: 'inst-1',
      }),
    ).toBe(true)
    expect(
      canStartGoogleOAuth({
        role: 'secretary',
        status: 'active',
        institutionId: 'inst-1',
      }),
    ).toBe(true)
  })

  it('rejects teacher and inactive users', () => {
    expect(
      canStartGoogleOAuth({
        role: 'teacher',
        status: 'active',
        institutionId: 'inst-1',
      }),
    ).toBe(false)
    expect(
      canStartGoogleOAuth({
        role: 'institution_manager',
        status: 'inactive',
        institutionId: 'inst-1',
      }),
    ).toBe(false)
    expect(
      canStartGoogleOAuth({
        role: 'secretary',
        status: 'active',
        institutionId: null,
      }),
    ).toBe(false)
  })
})

describe('OAuth state hashing + token encryption', () => {
  it('hashes state tokens one-way and rejects reuse conceptually via distinct hashes', async () => {
    const a = generateOAuthStateToken()
    const b = generateOAuthStateToken()
    expect(a).not.toBe(b)
    const ha = await hashOAuthStateToken(a)
    const hb = await hashOAuthStateToken(b)
    expect(ha).toHaveLength(64)
    expect(ha).not.toBe(hb)
    expect(await hashOAuthStateToken(a)).toBe(ha)
  })

  it('encrypts refresh tokens and never leaves plaintext in ciphertext', async () => {
    const keyBytes = new Uint8Array(32)
    crypto.getRandomValues(keyBytes)
    const keyB64 = btoa(String.fromCharCode(...keyBytes))
    const key = await importAesGcmKeyFromBase64(keyB64)
    const plain = '1//refresh-token-secret-value'
    const enc = await encryptRefreshToken(plain, key)
    expect(enc.ciphertextBase64).not.toContain(plain)
    expect(enc.nonceBase64.length).toBeGreaterThan(8)
    const dec = await decryptRefreshToken(enc.ciphertextBase64, enc.nonceBase64, key)
    expect(dec).toBe(plain)
  })

  it('redacts tokens from log payloads', () => {
    const redacted = redactSecretsForLog({
      refresh_token: 'secret',
      access_token: 'secret2',
      email: 'a@b.com',
      nested: { code_verifier: 'pkce' },
    }) as Record<string, unknown>
    expect(redacted.refresh_token).toBe('[REDACTED]')
    expect(redacted.access_token).toBe('[REDACTED]')
    expect(redacted.email).toBe('a@b.com')
    expect((redacted.nested as Record<string, unknown>).code_verifier).toBe('[REDACTED]')
  })

  it('maps reauthorization_required UI status', () => {
    expect(
      resolveGoogleConnectionUiStatus({
        connectionStatus: 'reauthorization_required',
        connected: false,
      }),
    ).toBe('reauthorization_required')
    expect(
      resolveGoogleConnectionUiStatus({
        connectionStatus: 'connected',
        connected: true,
      }),
    ).toBe('connected')
  })
})

describe('Edge Function authorization model (source guards)', () => {
  const start = readFileSync(
    resolve(process.cwd(), 'supabase/functions/google-oauth-start/index.ts'),
    'utf8',
  )
  const callback = readFileSync(
    resolve(process.cwd(), 'supabase/functions/google-oauth-callback/index.ts'),
    'utf8',
  )
  const disconnect = readFileSync(
    resolve(process.cwd(), 'supabase/functions/google-oauth-disconnect/index.ts'),
    'utf8',
  )
  const status = readFileSync(
    resolve(process.cwd(), 'supabase/functions/google-oauth-status/index.ts'),
    'utf8',
  )

  it('start requires user JWT and oauth actor RPC', () => {
    expect(start).toContain('getBearerToken')
    expect(start).toContain('meeting_calendar_get_google_oauth_actor')
    expect(start).toContain('access_type')
    expect(start).toContain('offline')
    expect(start).toContain('meeting_calendar_service_create_oauth_state')
    expect(start).not.toContain('VITE_')
  })

  it('callback rejects bad state and does not store credentials on error paths', () => {
    expect(callback).toContain('meeting_calendar_service_consume_oauth_state')
    expect(callback).toContain('state_reused')
    expect(callback).toContain('state_expired')
    expect(callback).toContain('redirect_uri_mismatch')
    expect(callback).toContain('p_has_new_refresh_token')
    expect(callback).toContain('encryptRefreshToken')
    expect(callback).toContain('no credentials stored on error')
    expect(callback).toContain('safeOAuthConfigError')
    expect(callback).toContain('oauth2.googleapis.com/token')
    expect(callback).toContain('client_secret: config.clientSecret')
    expect(callback).toContain('code_verifier: consumed.code_verifier')
    expect(callback).toContain("grant_type: 'authorization_code'")
    expect(callback).toContain("googleError === 'invalid_client' ? 'invalid_client'")
    expect(callback).not.toContain('meeting_calendar_claim_meet_provision')
    expect(callback).not.toContain('calendar/v3/calendars')
  })

  it('start surfaces safe misconfigured reasons without Vite secrets', () => {
    expect(start).toContain('safeOAuthConfigError')
    expect(start).toContain('Missing env:')
    expect(start).not.toContain('VITE_')
  })

  it('disconnect revokes remotely then clears local credentials', () => {
    expect(disconnect).toContain('oauth2.googleapis.com/revoke')
    expect(disconnect).toContain('meeting_calendar_service_revoke_google_connection')
    expect(disconnect).toContain('meeting_calendar_service_get_google_refresh_secret')
  })

  it('status returns only connected fields', () => {
    expect(status).toContain('connection_status')
    expect(status).toContain('email')
    expect(status).not.toContain('refresh_token')
    expect(status).not.toContain('ciphertext')
  })
})
