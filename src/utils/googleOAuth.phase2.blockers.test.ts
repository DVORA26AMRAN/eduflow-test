import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GOOGLE_OAUTH_APP_RETURN_URL_ALLOWLIST,
  isAppReturnUrlAllowlisted,
  normalizeAppReturnUrl,
  resolveAllowedAppReturnUrl,
} from './googleOAuthAppReturnAllowlist'
import {
  decryptRefreshTokenWithKeyRing,
  encryptRefreshToken,
  importAesGcmKeyFromBase64,
} from './googleOAuthCrypto'
import {
  isReencryptNeeded,
  selectDecryptKeyIds,
} from './googleTokenEncryptionRotation'

const blockersMigration = resolve(
  process.cwd(),
  'supabase/migrations/20250729120000_meeting_calendar_google_oauth_phase2_blockers.sql',
)

describe('GOOGLE_OAUTH_APP_RETURN_URL strict allowlist', () => {
  it('accepts only hardcoded allowlist entries', () => {
    expect(GOOGLE_OAUTH_APP_RETURN_URL_ALLOWLIST.length).toBeGreaterThan(0)
    for (const entry of GOOGLE_OAUTH_APP_RETURN_URL_ALLOWLIST) {
      expect(resolveAllowedAppReturnUrl(entry)).toBe(normalizeAppReturnUrl(entry))
      expect(isAppReturnUrlAllowlisted(entry)).toBe(true)
    }
  })

  it('rejects URLs not on the allowlist even if well-formed', () => {
    expect(() => resolveAllowedAppReturnUrl('https://evil.example/')).toThrow(/allowlist/i)
    expect(isAppReturnUrlAllowlisted('https://evil.example/')).toBe(false)
    expect(() => resolveAllowedAppReturnUrl('https://adoflow.example/?x=1')).toThrow()
  })

  it('rejects credentials and query/hash in return URL', () => {
    expect(() =>
      normalizeAppReturnUrl('http://user:pass@localhost:5173/'),
    ).toThrow(/credentials/i)
    expect(() => normalizeAppReturnUrl('http://localhost:5173/?a=1')).toThrow(/query or hash/i)
  })

  it('Edge env helper requires allowlist match (source)', () => {
    const env = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/googleOAuthEnv.ts'),
      'utf8',
    )
    expect(env).toContain('resolveAllowedAppReturnUrl')
    expect(env).toContain('GOOGLE_OAUTH_APP_RETURN_URL')
    expect(env).toContain('hardcoded allowlist')
  })
})

describe('OAuth state cleanup + retention', () => {
  const sql = readFileSync(blockersMigration, 'utf8')

  it('documents retention policy and implements cleanup RPC', () => {
    expect(sql).toContain('RETENTION POLICY — google_oauth_states')
    expect(sql).toContain('24 hours after consumed_at')
    expect(sql).toContain('meeting_calendar_cleanup_google_oauth_states')
    expect(sql).toContain('deleted_expired_unconsumed')
    expect(sql).toContain('deleted_consumed')
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.meeting_calendar_cleanup_google_oauth_states(TIMESTAMPTZ, INTERVAL) TO service_role',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.meeting_calendar_cleanup_google_oauth_states(TIMESTAMPTZ, INTERVAL) FROM authenticated',
    )
  })

  it('Edge Functions invoke cleanup opportunistically', () => {
    const start = readFileSync(
      resolve(process.cwd(), 'supabase/functions/google-oauth-start/index.ts'),
      'utf8',
    )
    const callback = readFileSync(
      resolve(process.cwd(), 'supabase/functions/google-oauth-callback/index.ts'),
      'utf8',
    )
    expect(start).toContain('runOAuthStateCleanup')
    expect(callback).toContain('runOAuthStateCleanup')
  })
})

describe('Encryption key rotation architecture', () => {
  const sql = readFileSync(blockersMigration, 'utf8')

  it('adds encryption_key_id, key registry, and reencrypt RPCs', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.google_token_encryption_keys')
    expect(sql).toContain("'active', 'decrypt_only', 'retired'")
    expect(sql).toContain('encryption_key_id')
    expect(sql).toContain('meeting_calendar_service_list_connections_needing_reencrypt')
    expect(sql).toContain('meeting_calendar_service_update_reencrypted_refresh_token')
    expect(sql).toContain('Production key rotation is NOT executed')
  })

  it('selects dual-key decrypt candidates correctly', () => {
    expect(
      selectDecryptKeyIds({
        rowKeyId: 'v1',
        activeKeyId: 'v1',
        previousKeyId: 'v0',
      }),
    ).toEqual(['v1'])
    expect(
      selectDecryptKeyIds({
        rowKeyId: 'v0',
        activeKeyId: 'v1',
        previousKeyId: 'v0',
      }),
    ).toEqual(['v0'])
    expect(isReencryptNeeded('v0', 'v1')).toBe(true)
    expect(isReencryptNeeded('v1', 'v1')).toBe(false)
  })

  it('dual-key decrypt works with previous key material', async () => {
    const prevBytes = new Uint8Array(32)
    const activeBytes = new Uint8Array(32)
    crypto.getRandomValues(prevBytes)
    crypto.getRandomValues(activeBytes)
    const previousKey = btoa(String.fromCharCode(...prevBytes))
    const activeKey = btoa(String.fromCharCode(...activeBytes))

    const prevCryptoKey = await importAesGcmKeyFromBase64(previousKey)
    const enc = await encryptRefreshToken('refresh-secret', prevCryptoKey)

    const result = await decryptRefreshTokenWithKeyRing(
      enc.ciphertextBase64,
      enc.nonceBase64,
      'v0',
      {
        activeKeyId: 'v1',
        activeKey,
        previousKeyId: 'v0',
        previousKey,
      },
    )
    expect(result.plaintext).toBe('refresh-secret')
    expect(result.usedKeyId).toBe('v0')
  })

  it('reencrypt Edge Function is disabled by default', () => {
    const reencrypt = readFileSync(
      resolve(process.cwd(), 'supabase/functions/google-token-reencrypt/index.ts'),
      'utf8',
    )
    expect(reencrypt).toContain('ENABLE_GOOGLE_TOKEN_REENCRYPT')
    expect(reencrypt).toContain('reencrypt_disabled')
    expect(reencrypt).toContain('decryptRefreshTokenWithKeyRing')
  })
})
