import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GOOGLE_OAUTH_APP_RETURN_URL_ALLOWLIST } from './googleOAuthAppReturnAllowlist'
import {
  buildCalendarEventBody,
  deriveConferenceRequestIdFromOutboxKey,
  extractParticipantMeetJoinUrl,
  isClaimableOutboxStatus,
  mapGoogleTokenErrorToProvisionAction,
  shouldShortCircuitExistingMeetUrl,
} from './googleMeetProvision'
import { redactSecretsForLog } from './googleOAuthCrypto'

const phase3Migration = resolve(
  process.cwd(),
  'supabase/migrations/20250729130000_meeting_calendar_google_meet_provision_phase3.sql',
)
const phase1Migration = resolve(
  process.cwd(),
  'supabase/migrations/20250729100000_meeting_calendar_google_meet_provision_phase1.sql',
)

describe('OAuth allowlist parity (frontend shared JSON ↔ Edge JSON ↔ config mirror)', () => {
  it('keeps Edge and config JSON allowlists identical', () => {
    const edge = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'supabase/functions/_shared/googleOAuthAppReturnAllowlist.entries.json',
        ),
        'utf8',
      ),
    )
    const config = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'config/googleOAuthAppReturnAllowlist.entries.json'),
        'utf8',
      ),
    )
    expect(edge).toEqual(config)
    expect(GOOGLE_OAUTH_APP_RETURN_URL_ALLOWLIST).toEqual(edge)
  })

  it('documents staging URL gate: no wildcard / preview entries', () => {
    for (const entry of GOOGLE_OAUTH_APP_RETURN_URL_ALLOWLIST) {
      expect(entry).not.toMatch(/\*/)
      expect(entry).not.toMatch(/vercel\.app\/.*--/)
      expect(entry.endsWith('/')).toBe(true)
    }
  })
})

describe('Phase 3 Meet provision migration + claim guards', () => {
  const sql3 = readFileSync(phase3Migration, 'utf8')
  const sql1 = readFileSync(phase1Migration, 'utf8')
  const worker = readFileSync(
    resolve(process.cwd(), 'supabase/functions/meeting-meet-provisioner/index.ts'),
    'utf8',
  )
  const googleApi = readFileSync(
    resolve(process.cwd(), 'supabase/functions/_shared/googleMeetProvision.ts'),
    'utf8',
  )

  it('claims pending only and never awaiting_connection', () => {
    expect(sql1).toContain("WHERE status = 'pending'")
    expect(sql1).toContain('meeting_calendar_claim_meet_provision_batch')
    expect(isClaimableOutboxStatus('pending')).toBe(true)
    expect(isClaimableOutboxStatus('awaiting_connection')).toBe(false)
    expect(sql3).toContain('awaiting_connection is never claimed')
    expect(worker).toContain('Claims pending rows only')
  })

  it('exposes service-role context / status RPCs only', () => {
    expect(sql3).toContain('meeting_calendar_service_get_meet_provision_context')
    expect(sql3).toContain('meeting_calendar_service_set_meet_provision_status')
    expect(sql3).toContain(
      'REVOKE ALL ON FUNCTION public.meeting_calendar_service_get_meet_provision_context(UUID) FROM authenticated',
    )
    expect(sql3).toContain(
      'GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_get_meet_provision_context(UUID) TO service_role',
    )
    expect(sql3).toContain('Meet provisioning is only for online meetings')
    expect(sql3).toContain('Meet provisioning requires a confirmed meeting')
    expect(sql3).toContain('Institution mismatch')
  })

  it('worker uses complete/fail/attach path and marks reauthorization', () => {
    expect(worker).toContain('meeting_calendar_complete_meet_provision')
    expect(worker).toContain('meeting_calendar_fail_meet_provision')
    expect(worker).toContain('meeting_calendar_service_mark_google_reauthorization_required')
    expect(worker).toContain('createOrReuseMeetCalendarEvent')
    expect(worker).toContain('refreshGoogleAccessToken')
    expect(worker).toContain('getGoogleApiCredentials')
    expect(worker).not.toContain('VITE_')
  })

  it('creates Calendar events with conferenceDataVersion=1, sendUpdates=none, no attendees', () => {
    expect(googleApi).toContain('conferenceDataVersion=1')
    expect(googleApi).toContain('sendUpdates=none')
    expect(googleApi).toContain('attendees: []')
    expect(googleApi).toContain('adoflow_request_key')
    expect(googleApi).not.toContain('calendar/sync')
    expect(googleApi).not.toContain('events.watch')
  })
})

describe('Meet provision idempotency + business rules', () => {
  it('derives deterministic conference requestId from outbox request_key', async () => {
    const key =
      'adoflow-11111111-1111-1111-1111-111111111111-22222222-2222-2222-2222-222222222222'
    const a = await deriveConferenceRequestIdFromOutboxKey(key)
    const b = await deriveConferenceRequestIdFromOutboxKey(key)
    expect(a).toBe(b)
    expect(a).toHaveLength(32)
  })

  it('extracts only participant Meet join URL', () => {
    expect(
      extractParticipantMeetJoinUrl({
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
      }),
    ).toBe('https://meet.google.com/abc-defg-hij')
    expect(
      extractParticipantMeetJoinUrl({
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+1555' },
            { entryPointType: 'video', uri: 'https://meet.google.com/xyz-uvwx-rst' },
          ],
        },
      }),
    ).toBe('https://meet.google.com/xyz-uvwx-rst')
  })

  it('short-circuits when meet_url already exists', () => {
    expect(shouldShortCircuitExistingMeetUrl('https://meet.google.com/abc-defg-hij')).toBe(true)
    expect(shouldShortCircuitExistingMeetUrl(null)).toBe(false)
  })

  it('maps revoked Google token to reauthorization_required', () => {
    expect(mapGoogleTokenErrorToProvisionAction('invalid_grant')).toBe(
      'reauthorization_required',
    )
    expect(mapGoogleTokenErrorToProvisionAction('timeout')).toBe('retry')
  })

  it('event body has no attendees and embeds request key for reuse', async () => {
    const conferenceRequestId = await deriveConferenceRequestIdFromOutboxKey('adoflow-m-s')
    const body = buildCalendarEventBody({
      subject: 'Test',
      startsAtIso: '2026-08-01T10:00:00Z',
      endsAtIso: '2026-08-01T10:30:00Z',
      timeZone: 'Asia/Jerusalem',
      requestKey: 'adoflow-m-s',
      conferenceRequestId,
    })
    expect(body.attendees).toEqual([])
    expect(body.conferenceData.createRequest.requestId).toBe(conferenceRequestId)
    expect(body.extendedProperties.private.adoflow_request_key).toBe('adoflow-m-s')
  })

  it('never leaves Meet URLs or tokens in redacted logs', () => {
    const redacted = redactSecretsForLog(
      'token=access_token=ya29.xxx meet https://meet.google.com/abc-defg-hij refresh_token=1//x',
    ) as string
    expect(redacted).not.toContain('ya29')
    expect(redacted).not.toContain('meet.google.com/abc')
    expect(redacted).toContain('[REDACTED')
  })
})
