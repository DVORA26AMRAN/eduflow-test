/**
 * meeting-meet-token-diagnostic
 *
 * Isolated read-only probe for the Google refresh-token path.
 * Uses the same decrypt + token-refresh helpers as meeting-meet-provisioner.
 *
 * Does NOT:
 * - create Calendar / Meet events
 * - mark reauthorization_required
 * - clear stored refresh tokens
 * - enqueue outbox work
 *
 * Authorization: service_role JWT only.
 */
import {
  CORS_HEADERS,
  createServiceClient,
  getBearerToken,
  getGoogleApiCredentials,
  jsonResponse,
} from '../_shared/googleOAuthEnv.ts'
import { requireServiceRoleJwt } from '../_shared/requireServiceRole.ts'
import { redactSecretsForLog } from '../_shared/googleOAuthCrypto.ts'
import {
  loadOwnerRefreshTokenPlaintext,
  refreshGoogleAccessToken,
} from '../_shared/googleMeetProvision.ts'

type SafeDiagnosticBody = {
  ok: boolean
  branch: string
  refresh_secret_found: boolean
  encryption_key_id: string | null
  encryption_key_found_in_ring: boolean
  active_key_id: string
  previous_key_id_present: boolean
  decrypt_succeeded: boolean | null
  token_refresh_request_sent: boolean
  token_refresh_http_status: number | null
  google_oauth_error_code: string | null
  google_oauth_error_description: string | null
  authorization_status_unchanged: true
  calendar_request_reached: false
  client_id_fingerprint: string
  client_secret_present: true
}

async function fingerprintClientId(clientId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(clientId.trim()),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
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
    const config = getGoogleApiCredentials()
    const service = createServiceClient()
    const body = (await request.json().catch(() => ({}))) as {
      user_id?: unknown
    }
    const userId = typeof body.user_id === 'string' ? body.user_id.trim() : ''
    if (!userId) {
      return jsonResponse({ ok: false, error: 'user_id_required' }, 400)
    }

    const clientIdFingerprint = await fingerprintClientId(config.clientId)
    const base: Omit<
      SafeDiagnosticBody,
      | 'ok'
      | 'branch'
      | 'refresh_secret_found'
      | 'encryption_key_id'
      | 'encryption_key_found_in_ring'
      | 'decrypt_succeeded'
      | 'token_refresh_request_sent'
      | 'token_refresh_http_status'
      | 'google_oauth_error_code'
      | 'google_oauth_error_description'
    > = {
      active_key_id: config.tokenEncryption.activeKeyId,
      previous_key_id_present: Boolean(
        config.tokenEncryption.previousKeyId && config.tokenEncryption.previousKey,
      ),
      authorization_status_unchanged: true,
      calendar_request_reached: false,
      client_id_fingerprint: clientIdFingerprint,
      client_secret_present: true,
    }

    const { data: secret, error: secretError } = await service.rpc(
      'meeting_calendar_service_get_google_refresh_secret',
      { p_user_id: userId },
    )

    if (secretError || secret?.found !== true) {
      const payload: SafeDiagnosticBody = {
        ...base,
        ok: false,
        branch: 'refresh_secret_missing',
        refresh_secret_found: false,
        encryption_key_id: null,
        encryption_key_found_in_ring: false,
        decrypt_succeeded: null,
        token_refresh_request_sent: false,
        token_refresh_http_status: null,
        google_oauth_error_code: null,
        google_oauth_error_description: null,
      }
      console.log('meet-token-diagnostic', payload)
      return jsonResponse(payload)
    }

    const encryptionKeyId =
      typeof secret.encryption_key_id === 'string' ? secret.encryption_key_id : null
    const encryptionKeyFoundInRing =
      encryptionKeyId !== null &&
      (encryptionKeyId === config.tokenEncryption.activeKeyId ||
        (encryptionKeyId === config.tokenEncryption.previousKeyId &&
          config.tokenEncryption.previousKey !== null))

    let refreshToken: string
    try {
      refreshToken = await loadOwnerRefreshTokenPlaintext({
        ciphertextB64: secret.refresh_token_ciphertext,
        nonceB64: secret.refresh_token_nonce,
        encryptionKeyId,
        ring: config.tokenEncryption,
      })
    } catch {
      const payload: SafeDiagnosticBody = {
        ...base,
        ok: false,
        branch: 'decrypt_failed',
        refresh_secret_found: true,
        encryption_key_id: encryptionKeyId,
        encryption_key_found_in_ring: encryptionKeyFoundInRing,
        decrypt_succeeded: false,
        token_refresh_request_sent: false,
        token_refresh_http_status: null,
        google_oauth_error_code: null,
        google_oauth_error_description: null,
      }
      console.log('meet-token-diagnostic', payload)
      return jsonResponse(payload)
    }

    const tokenResult = await refreshGoogleAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken,
    })

    if (!tokenResult.ok) {
      const payload: SafeDiagnosticBody = {
        ...base,
        ok: false,
        branch: 'token_refresh_rejected',
        refresh_secret_found: true,
        encryption_key_id: encryptionKeyId,
        encryption_key_found_in_ring: encryptionKeyFoundInRing,
        decrypt_succeeded: true,
        token_refresh_request_sent: true,
        token_refresh_http_status: tokenResult.httpStatus,
        google_oauth_error_code: tokenResult.googleError,
        google_oauth_error_description: tokenResult.googleErrorDescription,
      }
      console.log('meet-token-diagnostic', payload)
      return jsonResponse(payload)
    }

    const payload: SafeDiagnosticBody = {
      ...base,
      ok: true,
      branch: 'token_refresh_succeeded',
      refresh_secret_found: true,
      encryption_key_id: encryptionKeyId,
      encryption_key_found_in_ring: encryptionKeyFoundInRing,
      decrypt_succeeded: true,
      token_refresh_request_sent: true,
      token_refresh_http_status: tokenResult.httpStatus,
      google_oauth_error_code: null,
      google_oauth_error_description: null,
    }
    console.log('meet-token-diagnostic', payload)
    return jsonResponse(payload)
  } catch (error) {
    console.error('meet-token-diagnostic error', redactSecretsForLog(String(error)))
    return jsonResponse({ ok: false, error: 'internal_error' }, 500)
  }
})
