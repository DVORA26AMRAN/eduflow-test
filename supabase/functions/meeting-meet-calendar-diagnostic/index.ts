/**
 * meeting-meet-calendar-diagnostic
 *
 * Read-only probe: decrypt → refresh → GET calendars/primary.
 * Does NOT create events, mutate meetings, clear tokens, or mark reauthorization.
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
  probeGoogleCalendarAccess,
  refreshGoogleAccessToken,
} from '../_shared/googleMeetProvision.ts'

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
    const body = (await request.json().catch(() => ({}))) as { user_id?: unknown }
    const userId = typeof body.user_id === 'string' ? body.user_id.trim() : ''
    if (!userId) {
      return jsonResponse({ ok: false, error: 'user_id_required' }, 400)
    }

    const base = {
      authorization_status_unchanged: true as const,
      connection_mutated: false as const,
      meeting_mutated: false as const,
      calendar_mutated: false as const,
    }

    const { data: secret, error: secretError } = await service.rpc(
      'meeting_calendar_service_get_google_refresh_secret',
      { p_user_id: userId },
    )

    if (secretError || secret?.found !== true) {
      return jsonResponse({
        ...base,
        ok: false,
        branch: 'refresh_secret_missing',
        token_refresh_succeeded: false,
        calendar_http_status: null,
        google_reason: null,
        google_message: null,
        classification: null,
      })
    }

    let refreshToken: string
    try {
      refreshToken = await loadOwnerRefreshTokenPlaintext({
        ciphertextB64: secret.refresh_token_ciphertext,
        nonceB64: secret.refresh_token_nonce,
        encryptionKeyId:
          typeof secret.encryption_key_id === 'string' ? secret.encryption_key_id : null,
        ring: config.tokenEncryption,
      })
    } catch {
      return jsonResponse({
        ...base,
        ok: false,
        branch: 'decrypt_failed',
        token_refresh_succeeded: false,
        calendar_http_status: null,
        google_reason: null,
        google_message: null,
        classification: null,
      })
    }

    const tokenResult = await refreshGoogleAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken,
    })

    if (!tokenResult.ok) {
      return jsonResponse({
        ...base,
        ok: false,
        branch: 'token_refresh_rejected',
        token_refresh_succeeded: false,
        token_refresh_http_status: tokenResult.httpStatus,
        google_oauth_error_code: tokenResult.googleError,
        calendar_http_status: null,
        google_reason: null,
        google_message: null,
        classification: null,
      })
    }

    const probe = await probeGoogleCalendarAccess({
      accessToken: tokenResult.accessToken,
    })

    const payload = {
      ...base,
      ok: probe.ok,
      branch: probe.ok ? 'calendar_probe_ok' : 'calendar_probe_failed',
      token_refresh_succeeded: true,
      token_refresh_http_status: tokenResult.httpStatus,
      calendar_http_status: probe.httpStatus,
      google_reason: probe.googleReason,
      google_message: probe.googleMessage,
      classification: probe.classification,
      calendar_operation: probe.operation,
      would_invalidate_oauth: probe.invalidateOAuth,
    }
    console.log('meet-calendar-diagnostic', payload)
    return jsonResponse(payload)
  } catch (error) {
    console.error('meet-calendar-diagnostic error', redactSecretsForLog(String(error)))
    return jsonResponse({ ok: false, error: 'internal_error' }, 500)
  }
})
