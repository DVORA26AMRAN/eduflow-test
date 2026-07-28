/**
 * Prepared Edge entrypoint for background re-encryption during key rotation.
 * DO NOT schedule / deploy as a production cron until rotation runbook is approved.
 * Invokes service_role list + update RPCs; dual-key decrypt then encrypt with active key.
 */
import {
  CORS_HEADERS,
  createServiceClient,
  getTokenEncryptionKeyRing,
  jsonResponse,
} from '../_shared/googleOAuthEnv.ts'
import {
  decryptRefreshTokenWithKeyRing,
  encryptRefreshToken,
  importAesGcmKeyFromBase64,
  redactSecretsForLog,
} from '../_shared/googleOAuthCrypto.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  // Explicit kill-switch: production rotation must set ENABLE_GOOGLE_TOKEN_REENCRYPT=true
  if (Deno.env.get('ENABLE_GOOGLE_TOKEN_REENCRYPT') !== 'true') {
    return jsonResponse({
      ok: false,
      error: 'reencrypt_disabled',
      message: 'Background re-encryption is prepared but not enabled for production.',
    }, 403)
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  try {
    // Optional shared secret for operator-triggered runs (not end-user JWT).
    const expected = Deno.env.get('GOOGLE_TOKEN_REENCRYPT_INVOKE_SECRET')
    if (expected) {
      const provided = request.headers.get('x-reencrypt-secret')
      if (provided !== expected) {
        return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
      }
    }

    const ring = getTokenEncryptionKeyRing()
    const service = createServiceClient()
    const { data: batch, error: listError } = await service.rpc(
      'meeting_calendar_service_list_connections_needing_reencrypt',
      {
        p_target_key_id: ring.activeKeyId,
        p_limit: 50,
      },
    )

    if (listError || !batch?.ok) {
      console.error(
        'google-token-reencrypt list failed',
        redactSecretsForLog({ message: listError?.message }),
      )
      return jsonResponse({ ok: false, error: 'list_failed' }, 500)
    }

    const connections = Array.isArray(batch.connections) ? batch.connections : []
    const activeKey = await importAesGcmKeyFromBase64(ring.activeKey)
    let updated = 0
    let failed = 0

    for (const row of connections) {
      try {
        const { plaintext } = await decryptRefreshTokenWithKeyRing(
          row.refresh_token_ciphertext,
          row.refresh_token_nonce,
          row.encryption_key_id,
          ring,
        )
        const encrypted = await encryptRefreshToken(plaintext, activeKey)
        const { data: result, error: updateError } = await service.rpc(
          'meeting_calendar_service_update_reencrypted_refresh_token',
          {
            p_user_id: row.user_id,
            p_from_key_id: row.encryption_key_id,
            p_to_key_id: ring.activeKeyId,
            p_refresh_token_ciphertext_b64: encrypted.ciphertextBase64,
            p_refresh_token_nonce_b64: encrypted.nonceBase64,
          },
        )
        if (updateError || !result?.updated) {
          failed += 1
        } else {
          updated += 1
        }
      } catch (error) {
        failed += 1
        console.error(
          'google-token-reencrypt row failed',
          redactSecretsForLog({ message: String(error) }),
        )
      }
    }

    return jsonResponse({
      ok: true,
      target_key_id: ring.activeKeyId,
      scanned: connections.length,
      updated,
      failed,
    })
  } catch (error) {
    console.error('google-token-reencrypt error', redactSecretsForLog(String(error)))
    return jsonResponse({ ok: false, error: 'internal_error' }, 500)
  }
})
