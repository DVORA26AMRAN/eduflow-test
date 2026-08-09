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

        if (secretError || secret?.found !== true) {
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
            encryptionKeyId:
              typeof secret.encryption_key_id === 'string' ? secret.encryption_key_id : null,
            ring: config.tokenEncryption,
          })
        } catch {
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

        const tokenResult = await refreshGoogleAccessToken({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          refreshToken,
        })

        if (!tokenResult.ok) {
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
