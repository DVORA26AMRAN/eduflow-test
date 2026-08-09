/**
 * meeting-meet-crypto-compat
 *
 * Isolated AES-GCM compatibility probe.
 * - Self roundtrip encrypt→decrypt with the live key ring (synthetic plaintext only)
 * - SHA-256 fingerprint of decoded key material (never returns key bytes)
 * - Does not touch Google, DB credentials, UI, or cron
 *
 * Authorization: service_role JWT only.
 */
import {
  CORS_HEADERS,
  getBearerToken,
  getGoogleApiCredentials,
  jsonResponse,
} from '../_shared/googleOAuthEnv.ts'
import { requireServiceRoleJwt } from '../_shared/requireServiceRole.ts'
import {
  decryptRefreshToken,
  encryptRefreshToken,
  importAesGcmKeyFromBase64,
  redactSecretsForLog,
} from '../_shared/googleOAuthCrypto.ts'

const SYNTHETIC_PLAINTEXT = 'adoflow-crypto-self-test-v1'

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromBase64(base64: string): Uint8Array {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  const auth = requireServiceRoleJwt(getBearerToken(request))
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status)
  }

  try {
    // Same credential loader used by meeting-meet-provisioner / diagnostic.
    const provisionerCreds = getGoogleApiCredentials()
    // Callback encrypt path uses the same getGoogleApiCredentials via getGoogleOAuthConfig.
    const callbackCreds = getGoogleApiCredentials()

    const provisionerKeyBytes = fromBase64(provisionerCreds.tokenEncryption.activeKey)
    const callbackKeyBytes = fromBase64(callbackCreds.tokenEncryption.activeKey)

    const provisionerKeyFingerprint = (await sha256Hex(provisionerKeyBytes)).slice(0, 16)
    const callbackKeyFingerprint = (await sha256Hex(callbackKeyBytes)).slice(0, 16)

    let selfRoundtripSuccess = false
    let roundtripErrorClass: string | null = null
    try {
      const key = await importAesGcmKeyFromBase64(provisionerCreds.tokenEncryption.activeKey)
      const encrypted = await encryptRefreshToken(SYNTHETIC_PLAINTEXT, key)
      const decrypted = await decryptRefreshToken(
        encrypted.ciphertextBase64,
        encrypted.nonceBase64,
        key,
      )
      selfRoundtripSuccess = decrypted === SYNTHETIC_PLAINTEXT
    } catch (error) {
      roundtripErrorClass = error instanceof Error ? error.name : 'unknown'
    }

    const payload = {
      ok: true,
      self_roundtrip_success: selfRoundtripSuccess,
      roundtrip_error_class: roundtripErrorClass,
      callback_key_fingerprint: callbackKeyFingerprint,
      provisioner_key_fingerprint: provisionerKeyFingerprint,
      fingerprints_equal: callbackKeyFingerprint === provisionerKeyFingerprint,
      active_key_id: provisionerCreds.tokenEncryption.activeKeyId,
      callback_active_key_id: callbackCreds.tokenEncryption.activeKeyId,
      key_env_names: {
        active_key: 'GOOGLE_TOKEN_ENCRYPTION_KEY',
        active_key_id: 'GOOGLE_TOKEN_ENCRYPTION_KEY_ID',
        previous_key: 'GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS',
        previous_key_id: 'GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS_ID',
      },
      aes_gcm: {
        algorithm: 'AES-GCM',
        key_bytes_expected: 32,
        nonce_bytes: 12,
        aad_used: false,
        ciphertext_encoding: 'standard_base64',
        nonce_encoding: 'standard_base64',
        key_decoding: 'base64_to_raw_32_bytes',
      },
      helpers: {
        callback_encrypt: 'encryptRefreshToken + importAesGcmKeyFromBase64',
        provisioner_decrypt: 'decryptRefreshToken / decryptRefreshTokenWithKeyRing',
        shared_module: 'supabase/functions/_shared/googleOAuthCrypto.ts',
      },
    }

    console.log('meet-crypto-compat', payload)
    return jsonResponse(payload)
  } catch (error) {
    console.error('meet-crypto-compat error', redactSecretsForLog(String(error)))
    return jsonResponse({ ok: false, error: 'internal_error' }, 500)
  }
})
