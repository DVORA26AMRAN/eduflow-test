import {
  buildAppReturnRedirect,
  CORS_HEADERS,
  createServiceClient,
  getGoogleOAuthConfig,
  runOAuthStateCleanup,
} from '../_shared/googleOAuthEnv.ts'
import {
  encryptRefreshToken,
  hashOAuthStateToken,
  importAesGcmKeyFromBase64,
  redactSecretsForLog,
} from '../_shared/googleOAuthCrypto.ts'

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { ...CORS_HEADERS, Location: url },
  })
}

/**
 * google-oauth-callback
 * Google redirect target (GET). No user JWT.
 * Consumes one-time state, validates exact redirect URI, exchanges code, encrypts refresh token.
 * Does not create Calendar events or call Meet provisioner.
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  let config
  try {
    config = getGoogleOAuthConfig()
  } catch (error) {
    console.error('google-oauth-callback misconfigured', redactSecretsForLog(String(error)))
    return new Response('misconfigured', { status: 500 })
  }

  const fail = (code: string) =>
    redirect(buildAppReturnRedirect(config.appReturnBaseUrl, 'error', code))

  if (request.method !== 'GET') {
    return fail('method_not_allowed')
  }

  try {
    const url = new URL(request.url)
    const oauthError = url.searchParams.get('error')
    const stateToken = url.searchParams.get('state')
    const code = url.searchParams.get('code')

    if (oauthError) {
      console.error('google-oauth-callback provider error', redactSecretsForLog(oauthError))
      return fail('provider_error')
    }

    if (!stateToken || !code) {
      return fail('missing_code_or_state')
    }

    const stateHash = await hashOAuthStateToken(stateToken)
    const service = createServiceClient()

    const { data: consumed, error: consumeError } = await service.rpc(
      'meeting_calendar_service_consume_oauth_state',
      {
        p_state_token_hash: stateHash,
        p_expected_redirect_uri: config.redirectUri,
      },
    )

    if (consumeError || !consumed?.ok) {
      console.error(
        'google-oauth-callback state rejected',
        redactSecretsForLog({ message: consumeError?.message }),
      )
      const message = consumeError?.message ?? ''
      if (/already used/i.test(message)) return fail('state_reused')
      if (/expired/i.test(message)) return fail('state_expired')
      if (/Redirect URI/i.test(message)) return fail('redirect_uri_mismatch')
      if (/Invalid OAuth state/i.test(message)) return fail('state_invalid')
      return fail('state_rejected')
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: consumed.code_verifier,
      }),
    })

    const tokenJson = (await tokenRes.json()) as Record<string, unknown>

    if (!tokenRes.ok) {
      console.error(
        'google-oauth-callback token exchange failed',
        redactSecretsForLog({
          status: tokenRes.status,
          error: tokenJson.error,
          error_description: tokenJson.error_description,
        }),
      )
      return fail('token_exchange_failed')
    }

    const refreshToken =
      typeof tokenJson.refresh_token === 'string' ? tokenJson.refresh_token : null
    const accessToken =
      typeof tokenJson.access_token === 'string' ? tokenJson.access_token : null
    const scope =
      typeof tokenJson.scope === 'string'
        ? tokenJson.scope.split(/\s+/).filter(Boolean)
        : config.scopes

    let googleEmail: string | null = null
    if (accessToken) {
      try {
        const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (infoRes.ok) {
          const info = (await infoRes.json()) as Record<string, unknown>
          if (typeof info.email === 'string') {
            googleEmail = info.email
          }
        }
      } catch (infoError) {
        console.error(
          'google-oauth-callback userinfo failed',
          redactSecretsForLog(String(infoError)),
        )
      }
    }

    const key = await importAesGcmKeyFromBase64(config.tokenEncryption.activeKey)
    let ciphertextBase64: string | null = null
    let nonceBase64: string | null = null
    let hasNewRefresh = false

    if (refreshToken) {
      const encrypted = await encryptRefreshToken(refreshToken, key)
      ciphertextBase64 = encrypted.ciphertextBase64
      nonceBase64 = encrypted.nonceBase64
      hasNewRefresh = true
    }

    const { data: upserted, error: upsertError } = await service.rpc(
      'meeting_calendar_service_upsert_google_connection',
      {
        p_user_id: consumed.user_id,
        p_institution_id: consumed.institution_id,
        p_google_account_email: googleEmail,
        p_refresh_token_ciphertext_b64: hasNewRefresh ? ciphertextBase64 : null,
        p_refresh_token_nonce_b64: hasNewRefresh ? nonceBase64 : null,
        p_token_scopes: scope,
        p_has_new_refresh_token: hasNewRefresh,
        p_encryption_key_id: config.tokenEncryption.activeKeyId,
      },
    )

    if (upsertError || !upserted?.ok) {
      console.error(
        'google-oauth-callback upsert failed (no credentials stored on error)',
        redactSecretsForLog({ message: upsertError?.message }),
      )
      return fail('upsert_failed')
    }

    await runOAuthStateCleanup(service)

    return redirect(buildAppReturnRedirect(config.appReturnBaseUrl, 'connected'))
  } catch (error) {
    console.error('google-oauth-callback error', redactSecretsForLog(String(error)))
    return fail('internal_error')
  }
})
