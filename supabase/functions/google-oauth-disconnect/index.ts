import {
  CORS_HEADERS,
  createServiceClient,
  createUserClient,
  getBearerToken,
  getGoogleOAuthConfig,
  jsonResponse,
  runOAuthStateCleanup,
} from '../_shared/googleOAuthEnv.ts'
import {
  decryptRefreshTokenWithKeyRing,
  redactSecretsForLog,
} from '../_shared/googleOAuthCrypto.ts'

/**
 * google-oauth-disconnect
 * Authorization: Bearer <user JWT>
 * Attempts Google token revocation, then clears local encrypted credentials.
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  try {
    const authHeader = getBearerToken(request)
    if (!authHeader) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    }

    const userClient = createUserClient(authHeader)
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()
    if (userError || !user) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    }

    const { data: actor, error: actorError } = await userClient.rpc(
      'meeting_calendar_get_google_oauth_actor',
    )
    if (actorError || !actor?.ok || actor.user_id !== user.id) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    const config = getGoogleOAuthConfig()
    const service = createServiceClient()
    const { data: secret, error: secretError } = await service.rpc(
      'meeting_calendar_service_get_google_refresh_secret',
      { p_user_id: user.id },
    )

    if (secretError) {
      console.error(
        'google-oauth-disconnect secret read failed',
        redactSecretsForLog({ message: secretError.message }),
      )
    }

    if (secret?.found === true && secret.refresh_token_ciphertext && secret.refresh_token_nonce) {
      try {
        const { plaintext: refreshToken } = await decryptRefreshTokenWithKeyRing(
          secret.refresh_token_ciphertext,
          secret.refresh_token_nonce,
          typeof secret.encryption_key_id === 'string' ? secret.encryption_key_id : null,
          config.tokenEncryption,
        )
        const revokeRes = await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }),
        })
        if (!revokeRes.ok) {
          console.error(
            'google-oauth-disconnect google revoke non-ok',
            redactSecretsForLog({ status: revokeRes.status }),
          )
        }
      } catch (revokeError) {
        console.error(
          'google-oauth-disconnect google revoke failed',
          redactSecretsForLog(String(revokeError)),
        )
      }
    }

    const { data: revoked, error: revokeError } = await service.rpc(
      'meeting_calendar_service_revoke_google_connection',
      { p_user_id: user.id },
    )

    if (revokeError || !revoked?.ok) {
      console.error(
        'google-oauth-disconnect local revoke failed',
        redactSecretsForLog({ message: revokeError?.message }),
      )
      return jsonResponse({ ok: false, error: 'revoke_failed' }, 500)
    }

    await runOAuthStateCleanup(service)

    return jsonResponse({
      ok: true,
      connected: false,
      connection_status: 'not_connected',
    })
  } catch (error) {
    console.error('google-oauth-disconnect error', redactSecretsForLog(String(error)))
    return jsonResponse({ ok: false, error: 'internal_error' }, 500)
  }
})
