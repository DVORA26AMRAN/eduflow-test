/**
 * Live meeting status and action windows (client-side rules mirrored in SQL RPCs).
 *
 * Meet join URLs are system-managed (auto-provision after confirmation).
 * Clients must never accept or submit manual Meet URLs.
 *
 * TODO(E.164): replace permissive phone normalization with strict E.164 validation
 * (shared with SQL meeting_calendar_normalize_phone_number) before production hardening.
 */

export type MeetingFormat = 'online' | 'phone' | 'in_person'

export const MEETING_FORMATS: MeetingFormat[] = ['online', 'phone', 'in_person']

export const MEETING_DELAY_OPTIONS_MINUTES = [5, 10, 15] as const
export type MeetingDelayMinutes = (typeof MEETING_DELAY_OPTIONS_MINUTES)[number]

export type MeetingLiveStatusKind = 'upcoming' | 'live' | 'ended' | 'unknown'

export type MeetingLiveStatus = {
  kind: MeetingLiveStatusKind
  label: string
  minutesUntilStart: number | null
}

export type MeetingActivityEventType =
  | 'online_meeting_opened'
  | 'phone_call_started'
  | 'delay_reported'

const MINUTE_MS = 60_000

export function isMeetingFormat(value: unknown): value is MeetingFormat {
  return value === 'online' || value === 'phone' || value === 'in_person'
}

export function isMeetingDelayMinutes(value: unknown): value is MeetingDelayMinutes {
  return value === 5 || value === 10 || value === 15
}

export function translateMeetingFormat(format: MeetingFormat): string {
  if (format === 'online') {
    return 'מקוונת (Google Meet)'
  }
  if (format === 'phone') {
    return 'טלפונית'
  }
  return 'פרונטלית'
}

export function getMeetingLiveStatus(
  startsAtIso: string | null | undefined,
  endsAtIso: string | null | undefined,
  now: Date = new Date(),
): MeetingLiveStatus {
  if (!startsAtIso || !endsAtIso) {
    return { kind: 'unknown', label: '', minutesUntilStart: null }
  }

  const startsAt = new Date(startsAtIso)
  const endsAt = new Date(endsAtIso)
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { kind: 'unknown', label: '', minutesUntilStart: null }
  }

  const nowMs = now.getTime()
  if (nowMs >= endsAt.getTime()) {
    return { kind: 'ended', label: 'הסתיימה', minutesUntilStart: null }
  }

  if (nowMs >= startsAt.getTime()) {
    return { kind: 'live', label: 'מתקיימת עכשיו', minutesUntilStart: 0 }
  }

  const minutesUntilStart = Math.max(1, Math.ceil((startsAt.getTime() - nowMs) / MINUTE_MS))
  return {
    kind: 'upcoming',
    label: `מתחילה בעוד ${minutesUntilStart} דקות`,
    minutesUntilStart,
  }
}

export function isPrimaryLiveActionAvailable(
  startsAtIso: string | null | undefined,
  endsAtIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!startsAtIso || !endsAtIso) {
    return false
  }
  const startsAt = new Date(startsAtIso).getTime()
  const endsAt = new Date(endsAtIso).getTime()
  const nowMs = now.getTime()
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) {
    return false
  }
  return nowMs >= startsAt - 15 * MINUTE_MS && nowMs < endsAt
}

export function isDelayActionAvailable(
  startsAtIso: string | null | undefined,
  endsAtIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!startsAtIso || !endsAtIso) {
    return false
  }
  const startsAt = new Date(startsAtIso).getTime()
  const endsAt = new Date(endsAtIso).getTime()
  const nowMs = now.getTime()
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) {
    return false
  }
  return nowMs >= startsAt - 30 * MINUTE_MS && nowMs < endsAt
}

export function buildTelHref(phoneNumber: string): string {
  // TODO(E.164): normalize to E.164 before building tel: hrefs.
  const normalized = phoneNumber.replace(/[^\d+]/g, '')
  return `tel:${normalized}`
}

/**
 * Accepts standard Google Meet join URLs, including valid query parameters
 * (authuser, hs, pli, …). Rejects host/admin path segments and host query keys.
 */
export function isSafeGoogleMeetJoinUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'https:') {
      return false
    }
    if (parsed.hostname.toLowerCase() !== 'meet.google.com') {
      return false
    }
    if (!/^\/[a-z0-9-]+\/?$/i.test(parsed.pathname)) {
      return false
    }
    if (/host|admin|moderator/i.test(parsed.pathname)) {
      return false
    }
    for (const key of parsed.searchParams.keys()) {
      if (/^(host|admin|moderator)$/i.test(key)) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}
