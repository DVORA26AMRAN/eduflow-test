import {
  CORS_HEADERS,
  createUserClient,
  getBearerToken,
  jsonResponse,
} from '../_shared/googleOAuthEnv.ts'
import { redactSecretsForLog } from '../_shared/googleOAuthCrypto.ts'

/**
 * google-oauth-status
 * Authorization: Bearer <user JWT>
 * Proxies protected RPC. Returns only connection_status + email (never tokens).
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  try {
    const authHeader = getBearerToken(request)
    if (!authHeader) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    }

    const userClient = createUserClient(authHeader)
    const { data, error } = await userClient.rpc(
      'meeting_calendar_get_google_connection_status',
    )

    if (error) {
      console.error(
        'google-oauth-status denied',
        redactSecretsForLog({ message: error.message }),
      )
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    return jsonResponse({
      ok: true,
      connected: data?.connected === true,
      connection_status: data?.connection_status ?? 'not_connected',
      email: typeof data?.email === 'string' ? data.email : null,
    })
  } catch (error) {
    console.error('google-oauth-status error', redactSecretsForLog(String(error)))
    return jsonResponse({ ok: false, error: 'internal_error' }, 500)
  }
})
