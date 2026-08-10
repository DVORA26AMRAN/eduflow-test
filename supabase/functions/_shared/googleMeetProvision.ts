/**
 * Google Meet Calendar API helpers for Phase 3 provisioner.
 * Never log tokens, codes, ciphertext, or Meet URLs.
 */

import {
  classifyGoogleCalendarHttpFailure,
  type CalendarFailureCode,
} from './googleCalendarErrors.ts'
import {
  decryptRefreshTokenWithKeyRing,
  type TokenEncryptionKeyRing,
} from './googleOAuthCrypto.ts'

export const CALENDAR_EVENTS_INSERT_OPERATION = 'calendar.events.insert'
export const CALENDAR_PRIMARY_GET_OPERATION = 'calendar.calendars.get'

/** Async SHA-256 hex truncated to 32 chars for conferenceData.createRequest.requestId */
export async function deriveConferenceRequestIdAsync(
  outboxRequestKey: string,
): Promise<string> {
  const data = new TextEncoder().encode(outboxRequestKey)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

export type GoogleTokenRefreshResult =
  | {
      ok: true
      accessToken: string
      httpStatus: number
      googleError: null
      googleErrorDescription: null
    }
  | {
      ok: false
      code: 'REAUTHORIZATION_REQUIRED' | 'TOKEN_REFRESH_FAILED'
      message: string
      httpStatus: number | null
      googleError: string | null
      googleErrorDescription: string | null
    }

export async function refreshGoogleAccessToken(args: {
  clientId: string
  clientSecret: string
  refreshToken: string
  timeoutMs?: number
}): Promise<GoogleTokenRefreshResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 15000)
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: args.clientId,
        client_secret: args.clientSecret,
        refresh_token: args.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: controller.signal,
    })
    const json = (await res.json()) as Record<string, unknown>
    const googleErrorDescription =
      typeof json.error_description === 'string' ? json.error_description : null
    if (!res.ok) {
      const err = typeof json.error === 'string' ? json.error : ''
      if (err === 'invalid_grant' || err === 'unauthorized_client') {
        return {
          ok: false,
          code: 'REAUTHORIZATION_REQUIRED',
          message: 'Google refresh token revoked or expired.',
          httpStatus: res.status,
          googleError: err || null,
          googleErrorDescription,
        }
      }
      return {
        ok: false,
        code: 'TOKEN_REFRESH_FAILED',
        message: typeof json.error === 'string' ? json.error : 'token_refresh_failed',
        httpStatus: res.status,
        googleError: err || null,
        googleErrorDescription,
      }
    }
    if (typeof json.access_token !== 'string') {
      return {
        ok: false,
        code: 'TOKEN_REFRESH_FAILED',
        message: 'missing_access_token',
        httpStatus: res.status,
        googleError: null,
        googleErrorDescription,
      }
    }
    return {
      ok: true,
      accessToken: json.access_token,
      httpStatus: res.status,
      googleError: null,
      googleErrorDescription: null,
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    return {
      ok: false,
      code: 'TOKEN_REFRESH_FAILED',
      message: aborted ? 'token_refresh_timeout' : 'token_refresh_network_error',
      httpStatus: null,
      googleError: null,
      googleErrorDescription: null,
    }
  } finally {
    clearTimeout(timer)
  }
}

export function extractParticipantMeetJoinUrl(event: Record<string, unknown>): string | null {
  if (typeof event.hangoutLink === 'string' && event.hangoutLink.includes('meet.google.com')) {
    return event.hangoutLink
  }
  const conferenceData = event.conferenceData as Record<string, unknown> | undefined
  const entryPoints = conferenceData?.entryPoints
  if (Array.isArray(entryPoints)) {
    for (const ep of entryPoints) {
      const row = ep as Record<string, unknown>
      if (
        row.entryPointType === 'video' &&
        typeof row.uri === 'string' &&
        row.uri.includes('meet.google.com')
      ) {
        return row.uri
      }
    }
  }
  return null
}

export type CreateMeetEventResult =
  | { ok: true; eventId: string; meetUrl: string; reused: boolean }
  | {
      ok: false
      code:
        | CalendarFailureCode
        | 'GOOGLE_API_FAILED'
        | 'GOOGLE_API_TIMEOUT'
        | 'MEET_URL_MISSING'
      message: string
      httpStatus?: number | null
      googleReason?: string | null
      googleMessage?: string | null
      operation?: string
      invalidateOAuth?: boolean
    }

export async function findExistingEventByRequestKey(args: {
  accessToken: string
  requestKey: string
  timeoutMs?: number
}): Promise<{ eventId: string; raw: Record<string, unknown> } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 20000)
  try {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    url.searchParams.set('privateExtendedProperty', `adoflow_request_key=${args.requestKey}`)
    url.searchParams.set('maxResults', '1')
    url.searchParams.set('singleEvents', 'true')
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${args.accessToken}` },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { items?: Record<string, unknown>[] }
    const item = json.items?.[0]
    if (!item || typeof item.id !== 'string') return null
    return { eventId: item.id, raw: item }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function getCalendarEventById(args: {
  accessToken: string
  eventId: string
  timeoutMs?: number
}): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 20000)
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(args.eventId)}?conferenceDataVersion=1`,
      {
        headers: { Authorization: `Bearer ${args.accessToken}` },
        signal: controller.signal,
      },
    )
    if (res.status === 404) return null
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function createOrReuseMeetCalendarEvent(args: {
  accessToken: string
  requestKey: string
  existingEventId: string | null
  subject: string
  startsAtIso: string
  endsAtIso: string
  timeZone: string
  timeoutMs?: number
}): Promise<CreateMeetEventResult> {
  const conferenceRequestId = await deriveConferenceRequestIdAsync(args.requestKey)

  // Idempotent path 1: known Google event id
  if (args.existingEventId) {
    const existing = await getCalendarEventById({
      accessToken: args.accessToken,
      eventId: args.existingEventId,
      timeoutMs: args.timeoutMs,
    })
    if (existing) {
      const meetUrl = extractParticipantMeetJoinUrl(existing)
      if (meetUrl) {
        return { ok: true, eventId: args.existingEventId, meetUrl, reused: true }
      }
    }
  }

  // Idempotent path 2: search by private extended property
  const found = await findExistingEventByRequestKey({
    accessToken: args.accessToken,
    requestKey: args.requestKey,
    timeoutMs: args.timeoutMs,
  })
  if (found) {
    const meetUrl = extractParticipantMeetJoinUrl(found.raw)
    if (meetUrl) {
      return { ok: true, eventId: found.eventId, meetUrl, reused: true }
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 25000)
  try {
    const url =
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none'
    const body = {
      summary: args.subject,
      description: 'Adoflow online meeting',
      start: { dateTime: args.startsAtIso, timeZone: args.timeZone || 'UTC' },
      end: { dateTime: args.endsAtIso, timeZone: args.timeZone || 'UTC' },
      attendees: [],
      conferenceData: {
        createRequest: {
          requestId: conferenceRequestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      extendedProperties: {
        private: {
          adoflow_request_key: args.requestKey,
        },
      },
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>

    if (!res.ok) {
      const classified = classifyGoogleCalendarHttpFailure({
        httpStatus: res.status,
        responseBody: json,
        operation: CALENDAR_EVENTS_INSERT_OPERATION,
      })
      return {
        ok: false,
        code: classified.classification,
        message: classified.message ?? classified.classification.toLowerCase(),
        httpStatus: classified.httpStatus,
        googleReason: classified.reason,
        googleMessage: classified.message,
        operation: classified.operation,
        invalidateOAuth: classified.invalidateOAuth,
      }
    }

    const eventId = typeof json.id === 'string' ? json.id : null
    const meetUrl = extractParticipantMeetJoinUrl(json)
    if (!eventId || !meetUrl) {
      return { ok: false, code: 'MEET_URL_MISSING', message: 'meet_join_url_missing' }
    }
    return { ok: true, eventId, meetUrl, reused: false }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    return {
      ok: false,
      code: aborted ? 'GOOGLE_API_TIMEOUT' : 'GOOGLE_API_FAILED',
      message: aborted ? 'google_api_timeout' : 'google_api_network_error',
      invalidateOAuth: false,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Non-destructive Calendar capability probe (GET primary calendar).
 * Does not create events, mutate meetings, or clear OAuth tokens.
 */
export async function probeGoogleCalendarAccess(args: {
  accessToken: string
  timeoutMs?: number
}): Promise<{
  ok: boolean
  httpStatus: number | null
  googleReason: string | null
  googleMessage: string | null
  classification: CalendarFailureCode | 'CALENDAR_PROBE_OK' | 'CALENDAR_PROBE_TIMEOUT' | 'CALENDAR_PROBE_NETWORK'
  operation: string
  invalidateOAuth: boolean
}> {
  const operation = CALENDAR_PRIMARY_GET_OPERATION
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 15000)
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
      method: 'GET',
      headers: { Authorization: `Bearer ${args.accessToken}` },
      signal: controller.signal,
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) {
      return {
        ok: true,
        httpStatus: res.status,
        googleReason: null,
        googleMessage: null,
        classification: 'CALENDAR_PROBE_OK',
        operation,
        invalidateOAuth: false,
      }
    }
    const classified = classifyGoogleCalendarHttpFailure({
      httpStatus: res.status,
      responseBody: json,
      operation,
    })
    return {
      ok: false,
      httpStatus: classified.httpStatus,
      googleReason: classified.reason,
      googleMessage: classified.message,
      classification: classified.classification,
      operation: classified.operation,
      invalidateOAuth: classified.invalidateOAuth,
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    return {
      ok: false,
      httpStatus: null,
      googleReason: null,
      googleMessage: null,
      classification: aborted ? 'CALENDAR_PROBE_TIMEOUT' : 'CALENDAR_PROBE_NETWORK',
      operation,
      invalidateOAuth: false,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function loadOwnerRefreshTokenPlaintext(args: {
  ciphertextB64: string
  nonceB64: string
  encryptionKeyId: string | null
  ring: TokenEncryptionKeyRing
}): Promise<string> {
  const { plaintext } = await decryptRefreshTokenWithKeyRing(
    args.ciphertextB64,
    args.nonceB64,
    args.encryptionKeyId,
    args.ring,
  )
  return plaintext
}
