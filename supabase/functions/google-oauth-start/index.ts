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
  generateOAuthStateToken,
  generatePkceVerifier,
  hashOAuthStateToken,
  pkceChallengeS256,
  redactSecretsForLog,
} from '../_shared/googleOAuthCrypto.ts'

/**
 * google-oauth-start
 * Authorization: Bearer <user JWT>
 * Active institution_manager / secretary only.
 * Creates one-time OAuth state (user + institution + redirect URI + PKCE) and returns Google URL.
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

    const config = getGoogleOAuthConfig()
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

    if (actorError || !actor || actor.ok !== true) {
      console.error(
        'google-oauth-start actor denied',
        redactSecretsForLog({ message: actorError?.message, userId: user.id }),
      )
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    if (actor.user_id !== user.id) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    const stateToken = generateOAuthStateToken()
    const stateHash = await hashOAuthStateToken(stateToken)
    const codeVerifier = generatePkceVerifier()
    const codeChallenge = await pkceChallengeS256(codeVerifier)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const service = createServiceClient()
    const { data: created, error: createError } = await service.rpc(
      'meeting_calendar_service_create_oauth_state',
      {
        p_state_token_hash: stateHash,
        p_user_id: actor.user_id,
        p_institution_id: actor.institution_id,
        p_code_verifier: codeVerifier,
        p_redirect_uri: config.redirectUri,
        p_expires_at: expiresAt,
      },
    )

    if (createError || !created?.ok) {
      console.error(
        'google-oauth-start state create failed',
        redactSecretsForLog({ message: createError?.message }),
      )
      return jsonResponse({ ok: false, error: 'state_create_failed' }, 500)
    }

    await runOAuthStateCleanup(service)

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', config.clientId)
    authUrl.searchParams.set('redirect_uri', config.redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', config.scopes.join(' '))
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('include_granted_scopes', 'true')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.searchParams.set('state', stateToken)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')

    return jsonResponse({
      ok: true,
      authorizationUrl: authUrl.toString(),
      // Never return state plaintext secrets beyond what the browser needs for redirect.
    })
  } catch (error) {
    console.error('google-oauth-start error', redactSecretsForLog(String(error)))
    return jsonResponse({ ok: false, error: 'internal_error' }, 500)
  }
})
