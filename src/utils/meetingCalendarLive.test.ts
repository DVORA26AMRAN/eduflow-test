import { describe, expect, it } from 'vitest'
import {
  buildTelHref,
  getMeetingLiveStatus,
  isDelayActionAvailable,
  isPrimaryLiveActionAvailable,
  isSafeGoogleMeetJoinUrl,
  translateMeetingFormat,
} from './meetingCalendarLive'

describe('meetingCalendarLive', () => {
  const startsAt = '2026-07-27T12:00:00.000Z'
  const endsAt = '2026-07-27T12:30:00.000Z'

  it('labels upcoming, live, and ended statuses in Hebrew', () => {
    expect(getMeetingLiveStatus(startsAt, endsAt, new Date('2026-07-27T11:40:00.000Z')).label).toBe(
      'מתחילה בעוד 20 דקות',
    )
    expect(getMeetingLiveStatus(startsAt, endsAt, new Date('2026-07-27T12:10:00.000Z')).label).toBe(
      'מתקיימת עכשיו',
    )
    expect(getMeetingLiveStatus(startsAt, endsAt, new Date('2026-07-27T12:31:00.000Z')).label).toBe(
      'הסתיימה',
    )
  })

  it('opens primary actions from 15 minutes before until end', () => {
    expect(
      isPrimaryLiveActionAvailable(startsAt, endsAt, new Date('2026-07-27T11:44:00.000Z')),
    ).toBe(false)
    expect(
      isPrimaryLiveActionAvailable(startsAt, endsAt, new Date('2026-07-27T11:45:00.000Z')),
    ).toBe(true)
    expect(
      isPrimaryLiveActionAvailable(startsAt, endsAt, new Date('2026-07-27T12:29:00.000Z')),
    ).toBe(true)
    expect(
      isPrimaryLiveActionAvailable(startsAt, endsAt, new Date('2026-07-27T12:30:00.000Z')),
    ).toBe(false)
  })

  it('opens delay actions from 30 minutes before until end', () => {
    expect(isDelayActionAvailable(startsAt, endsAt, new Date('2026-07-27T11:29:00.000Z'))).toBe(
      false,
    )
    expect(isDelayActionAvailable(startsAt, endsAt, new Date('2026-07-27T11:30:00.000Z'))).toBe(
      true,
    )
    expect(isDelayActionAvailable(startsAt, endsAt, new Date('2026-07-27T12:29:00.000Z'))).toBe(
      true,
    )
    expect(isDelayActionAvailable(startsAt, endsAt, new Date('2026-07-27T12:30:00.000Z'))).toBe(
      false,
    )
  })

  it('validates Google Meet join URLs including query params and rejects host keys', () => {
    expect(isSafeGoogleMeetJoinUrl('https://meet.google.com/abc-defg-hij')).toBe(true)
    expect(isSafeGoogleMeetJoinUrl('https://meet.google.com/abc-defg-hij?authuser=0&hs=122')).toBe(
      true,
    )
    expect(isSafeGoogleMeetJoinUrl('https://meet.google.com/abc-defg-hij?pli=1')).toBe(true)
    expect(isSafeGoogleMeetJoinUrl('https://meet.google.com/abc-defg-hij?host=1')).toBe(false)
    expect(isSafeGoogleMeetJoinUrl('http://meet.google.com/abc-defg-hij')).toBe(false)
  })

  it('builds tel href without logging extras', () => {
    expect(buildTelHref('+972-50-123-4567')).toBe('tel:+972501234567')
  })

  it('translates meeting formats', () => {
    expect(translateMeetingFormat('online')).toBe('מקוונת (Google Meet)')
    expect(translateMeetingFormat('phone')).toBe('טלפונית')
    expect(translateMeetingFormat('in_person')).toBe('פרונטלית')
  })
})
