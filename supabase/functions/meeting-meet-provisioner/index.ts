/**
 * meeting-meet-provisioner
 * Durable outbox worker for Google Meet join URL creation.
 * Claims pending rows only. Never claims awaiting_connection.
 * Authorization: service_role JWT only (anon / authenticated → 403).
 * verify_jwt=true is not sufficient by itself.
 * No calendar sync.
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
  createOrReuseMeetCalendarEvent,
  loadOwnerRefreshTokenPlaintext,
  refreshGoogleAccessToken,
} from '../_shared/googleMeetProvision.ts'

const TRANSIENT_RETRY_SECONDS = 60
const MAX_ATTEMPTS_BEFORE_HARD_FAIL = 8

function safeErrorCode(code: string): string {
  // Never embed URLs or tokens in persisted errors.
  return code.replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
}

type RefreshTokenDiagnostic = {
  request_id: string
  meeting_id: unknown
  branch: string
  refresh_secret_found: boolean | null
  encryption_key_id: string | null
  encryption_key_found_in_ring: boolean | null
  decrypt_success: boolean | null
  token_refresh_request_sent: boolean | null
  token_refresh_http_status: number | null
  google_oauth_error_code: string | null
  calendar_request_reached: boolean | null
}

/** Safe ops diagnostics only — never tokens, ciphertext, nonce, or key material. */
function logRefreshTokenDiagnostic(fields: RefreshTokenDiagnostic): void {
  console.log('meet-provisioner refresh-token diagnostic', fields)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  // Defense in depth: reject anon/authenticated even if gateway verify_jwt passed.
  const auth = requireServiceRoleJwt(getBearerToken(request))
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status)
  }

  try {
    const config = getGoogleApiCredentials()
    const service = createServiceClient()

    const { data: claimed, error: claimError } = await service.rpc(
      'meeting_calendar_claim_meet_provision_batch',
      {
        p_limit: 10,
        p_lease_seconds: 90,
        p_worker_id: 'meeting-meet-provisioner',
      },
    )

    if (claimError || !claimed?.ok) {
      console.error(
        'meet-provisioner claim failed',
        redactSecretsForLog({ message: claimError?.message }),
      )
      return jsonResponse({ ok: false, error: 'claim_failed' }, 500)
    }

    const requests = Array.isArray(claimed.requests) ? claimed.requests : []
    let processed = 0
    let succeeded = 0
    let failed = 0
    let skipped = 0

    for (const row of requests) {
      processed += 1
      const requestId = row.id as string

      try {
        const { data: ctx, error: ctxError } = await service.rpc(
          'meeting_calendar_service_get_meet_provision_context',
          { p_request_id: requestId },
        )

        if (ctxError || !ctx?.ok) {
          const message = ctxError?.message ?? 'context_failed'
          const rejectNonEligible =
            /online meetings|confirmed meeting|Institution mismatch|slot/i.test(message)
          await service.rpc('meeting_calendar_fail_meet_provision', {
            p_request_id: requestId,
            p_error: safeErrorCode(
              rejectNonEligible ? 'provision_rejected' : 'context_failed',
            ),
            p_retry_delay_seconds: rejectNonEligible ? 0 : TRANSIENT_RETRY_SECONDS,
          })
          failed += 1
          console.error(
            'meet-provisioner context rejected',
            redactSecretsForLog({ message }),
          )
          continue
        }

        const meeting = ctx.meeting as Record<string, unknown>
        const slot = ctx.slot as Record<string, unknown>
        const req = ctx.request as Record<string, unknown>
        const ownerId = meeting.calendar_owner_id as string
        const institutionId = meeting.institution_id as string
        const requestKey = req.request_key as string

        // Short-circuit: Meet URL already attached
        if (typeof meeting.meet_url === 'string' && meeting.meet_url.length > 0) {
          await service.rpc('meeting_calendar_complete_meet_provision', {
            p_request_id: requestId,
            p_meet_url: meeting.meet_url,
            p_google_event_id:
              (typeof meeting.google_meet_event_id === 'string'
                ? meeting.google_meet_event_id
                : null) ??
              (typeof req.google_event_id === 'string' ? req.google_event_id : null),
          })
          succeeded += 1
          skipped += 1
          continue
        }

        if (institutionId !== (req.institution_id as string)) {
          await service.rpc('meeting_calendar_fail_meet_provision', {
            p_request_id: requestId,
            p_error: 'institution_mismatch',
            p_retry_delay_seconds: 0,
          })
          failed += 1
          continue
        }

        const { data: secret, error: secretError } = await service.rpc(
          'meeting_calendar_service_get_google_refresh_secret',
          { p_user_id: ownerId },
        )

        const refreshSecretFound = !secretError && secret?.found === true
        const encryptionKeyId =
          refreshSecretFound && typeof secret.encryption_key_id === 'string'
            ? secret.encryption_key_id
            : null
        const encryptionKeyFoundInRing =
          encryptionKeyId !== null &&
          (encryptionKeyId === config.tokenEncryption.activeKeyId ||
            (encryptionKeyId === config.tokenEncryption.previousKeyId &&
              config.tokenEncryption.previousKey !== null))

        const baseDiag = {
          request_id: requestId,
          meeting_id: meeting.id,
          refresh_secret_found: refreshSecretFound,
          encryption_key_id: encryptionKeyId,
          encryption_key_found_in_ring: encryptionKeyFoundInRing,
          decrypt_success: null as boolean | null,
          token_refresh_request_sent: null as boolean | null,
          token_refresh_http_status: null as number | null,
          google_oauth_error_code: null as string | null,
          calendar_request_reached: null as boolean | null,
        }

        if (!refreshSecretFound) {
          logRefreshTokenDiagnostic({
            ...baseDiag,
            branch: 'refresh_secret_missing',
          })
          await service.rpc('meeting_calendar_service_mark_google_reauthorization_required', {
            p_user_id: ownerId,
          })
          await service.rpc('meeting_calendar_fail_meet_provision', {
            p_request_id: requestId,
            p_error: 'GOOGLE_NOT_CONNECTED',
            p_retry_delay_seconds: 0,
          })
          await service.rpc('meeting_calendar_service_set_meet_provision_status', {
            p_meeting_id: meeting.id,
            p_status: 'google_not_connected',
            p_error: null,
          })
          failed += 1
          continue
        }

        if (secret.institution_id && secret.institution_id !== institutionId) {
          logRefreshTokenDiagnostic({
            ...baseDiag,
            branch: 'owner_institution_mismatch',
          })
          await service.rpc('meeting_calendar_fail_meet_provision', {
            p_request_id: requestId,
            p_error: 'owner_institution_mismatch',
            p_retry_delay_seconds: 0,
          })
          failed += 1
          continue
        }

        let refreshToken: string
        try {
          refreshToken = await loadOwnerRefreshTokenPlaintext({
            ciphertextB64: secret.refresh_token_ciphertext,
            nonceB64: secret.refresh_token_nonce,
            encryptionKeyId,
            ring: config.tokenEncryption,
          })
          logRefreshTokenDiagnostic({
            ...baseDiag,
            branch: 'decrypt_succeeded',
            decrypt_success: true,
          })
        } catch {
          logRefreshTokenDiagnostic({
            ...baseDiag,
            branch: 'decrypt_failed',
            decrypt_success: false,
          })
          await service.rpc('meeting_calendar_service_mark_google_reauthorization_required', {
            p_user_id: ownerId,
          })
          await service.rpc('meeting_calendar_fail_meet_provision', {
            p_request_id: requestId,
            p_error: 'REAUTHORIZATION_REQUIRED',
            p_retry_delay_seconds: 0,
          })
          failed += 1
          continue
        }

        logRefreshTokenDiagnostic({
          ...baseDiag,
          branch: 'token_refresh_request_sent',
          decrypt_success: true,
          token_refresh_request_sent: true,
        })

        const tokenResult = await refreshGoogleAccessToken({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          refreshToken,
        })

        if (!tokenResult.ok) {
          logRefreshTokenDiagnostic({
            ...baseDiag,
            branch: 'token_refresh_rejected',
            decrypt_success: true,
            token_refresh_request_sent: true,
            token_refresh_http_status: tokenResult.httpStatus,
            google_oauth_error_code: tokenResult.googleError,
            calendar_request_reached: false,
          })
          if (tokenResult.code === 'REAUTHORIZATION_REQUIRED') {
            await service.rpc('meeting_calendar_service_mark_google_reauthorization_required', {
              p_user_id: ownerId,
            })
            await service.rpc('meeting_calendar_fail_meet_provision', {
              p_request_id: requestId,
              p_error: 'REAUTHORIZATION_REQUIRED',
              p_retry_delay_seconds: 0,
            })
          } else {
            const attempts = Number(req.attempt_count ?? 1)
            await service.rpc('meeting_calendar_fail_meet_provision', {
              p_request_id: requestId,
              p_error: safeErrorCode(tokenResult.message),
              p_retry_delay_seconds:
                attempts >= MAX_ATTEMPTS_BEFORE_HARD_FAIL ? 0 : TRANSIENT_RETRY_SECONDS,
            })
          }
          failed += 1
          continue
        }

        logRefreshTokenDiagnostic({
          ...baseDiag,
          branch: 'calendar_request_reached',
          decrypt_success: true,
          token_refresh_request_sent: true,
          token_refresh_http_status: tokenResult.httpStatus,
          google_oauth_error_code: null,
          calendar_request_reached: true,
        })

        const existingEventId =
          (typeof req.google_event_id === 'string' && req.google_event_id) ||
          (typeof meeting.google_meet_event_id === 'string' && meeting.google_meet_event_id) ||
          null

        const eventResult = await createOrReuseMeetCalendarEvent({
          accessToken: tokenResult.accessToken,
          requestKey,
          existingEventId,
          subject: String(meeting.subject ?? 'Meeting'),
          startsAtIso: String(slot.starts_at),
          endsAtIso: String(slot.ends_at),
          timeZone: String(meeting.institution_timezone ?? 'UTC'),
        })

        if (!eventResult.ok) {
          logRefreshTokenDiagnostic({
            ...baseDiag,
            branch: 'calendar_request_failed',
            decrypt_success: true,
            token_refresh_request_sent: true,
            token_refresh_http_status: tokenResult.httpStatus,
            google_oauth_error_code: null,
            calendar_request_reached: true,
          })
          if (eventResult.code === 'REAUTHORIZATION_REQUIRED') {
            await service.rpc('meeting_calendar_service_mark_google_reauthorization_required', {
              p_user_id: ownerId,
            })
            await service.rpc('meeting_calendar_fail_meet_provision', {
              p_request_id: requestId,
              p_error: 'REAUTHORIZATION_REQUIRED',
              p_retry_delay_seconds: 0,
            })
          } else {
            const attempts = Number(req.attempt_count ?? 1)
            const retry =
              eventResult.code === 'GOOGLE_API_TIMEOUT' ||
              eventResult.code === 'GOOGLE_API_FAILED'
            await service.rpc('meeting_calendar_fail_meet_provision', {
              p_request_id: requestId,
              p_error: safeErrorCode(eventResult.code),
              p_retry_delay_seconds:
                retry && attempts < MAX_ATTEMPTS_BEFORE_HARD_FAIL
                  ? TRANSIENT_RETRY_SECONDS
                  : 0,
            })
          }
          failed += 1
          console.error(
            'meet-provisioner google event failed',
            redactSecretsForLog({ code: eventResult.code }),
          )
          continue
        }

        const { error: completeError } = await service.rpc(
          'meeting_calendar_complete_meet_provision',
          {
            p_request_id: requestId,
            p_meet_url: eventResult.meetUrl,
            p_google_event_id: eventResult.eventId,
          },
        )

        if (completeError) {
          await service.rpc('meeting_calendar_fail_meet_provision', {
            p_request_id: requestId,
            p_error: 'attach_failed',
            p_retry_delay_seconds: TRANSIENT_RETRY_SECONDS,
          })
          failed += 1
          console.error(
            'meet-provisioner attach failed',
            redactSecretsForLog({ message: completeError.message }),
          )
          continue
        }

        logRefreshTokenDiagnostic({
          ...baseDiag,
          branch: 'provision_succeeded',
          decrypt_success: true,
          token_refresh_request_sent: true,
          token_refresh_http_status: tokenResult.httpStatus,
          google_oauth_error_code: null,
          calendar_request_reached: true,
        })

        succeeded += 1
      } catch (error) {
        failed += 1
        console.error(
          'meet-provisioner row failed',
          redactSecretsForLog({ message: String(error) }),
        )
        try {
          await service.rpc('meeting_calendar_fail_meet_provision', {
            p_request_id: requestId,
            p_error: 'worker_internal_error',
            p_retry_delay_seconds: TRANSIENT_RETRY_SECONDS,
          })
        } catch {
          // ignore
        }
      }
    }

    return jsonResponse({
      ok: true,
      claimed: requests.length,
      processed,
      succeeded,
      failed,
      short_circuited: skipped,
    })
  } catch (error) {
    console.error('meet-provisioner error', redactSecretsForLog(String(error)))
    return jsonResponse({ ok: false, error: 'internal_error' }, 500)
  }
})
