import { describe, expect, it } from 'vitest'
import {
  buildMeetingReminderNotificationCopy,
  meetingReminderDedupKey,
  planMeetingReminders,
  planReminderRegenerationAfterRescheduleConfirm,
  shouldCancelAllPendingRemindersOnMeetingCancel,
  shouldKeepRemindersDuringRescheduleOverlay,
} from './meetingCalendarReminders'

describe('Phase 5 meeting reminder rules', () => {
  const referenceNow = new Date('2026-07-20T12:00:00.000Z')

  it('creates both 24h and 1h reminders when confirmation is >= 24h before start', () => {
    const startsAt = new Date('2026-07-22T12:00:00.000Z')
    const plan = planMeetingReminders(startsAt, referenceNow)

    expect(plan.kinds).toEqual(['24h', '1h'])
    expect(plan.skippedReason).toBeNull()
    expect(plan.scheduledFor['24h']?.toISOString()).toBe('2026-07-21T12:00:00.000Z')
    expect(plan.scheduledFor['1h']?.toISOString()).toBe('2026-07-22T11:00:00.000Z')
  })

  it('skips 24h reminder when meeting is confirmed less than 24h before start', () => {
    const startsAt = new Date('2026-07-20T20:00:00.000Z')
    const plan = planMeetingReminders(startsAt, referenceNow)

    expect(plan.kinds).toEqual(['1h'])
    expect(plan.skippedReason).toBe('less_than_24h')
    expect(plan.scheduledFor['24h']).toBeUndefined()
    expect(plan.scheduledFor['1h']?.toISOString()).toBe('2026-07-20T19:00:00.000Z')
  })

  it('creates no reminders when meeting is confirmed less than 1h before start', () => {
    const startsAt = new Date('2026-07-20T12:30:00.000Z')
    const plan = planMeetingReminders(startsAt, referenceNow)

    expect(plan.kinds).toEqual([])
    expect(plan.skippedReason).toBe('less_than_1h')
    expect(plan.scheduledFor).toEqual({})
  })

  it('keeps old reminders during reschedule overlay', () => {
    expect(shouldKeepRemindersDuringRescheduleOverlay()).toBe(true)
  })

  it('regenerates reminders only after replacement is finally confirmed', () => {
    const result = planReminderRegenerationAfterRescheduleConfirm({
      previousSlotId: 'slot-old',
      newSlotStartsAt: new Date('2026-07-25T09:00:00.000Z'),
      referenceNow,
    })

    expect(result.cancelPreviousSlotReminders).toBe(true)
    expect(result.previousSlotId).toBe('slot-old')
    expect(result.schedule.kinds).toEqual(['24h', '1h'])
  })

  it('cancels all pending reminders on meeting cancellation', () => {
    expect(shouldCancelAllPendingRemindersOnMeetingCancel()).toBe(true)
  })

  it('uses stable dedup keys for duplicate protection', () => {
    expect(meetingReminderDedupKey('m1', 's1', '24h')).toBe('m1:s1:24h')
    expect(meetingReminderDedupKey('m1', 's1', '24h')).toBe(
      meetingReminderDedupKey('m1', 's1', '24h'),
    )
    expect(meetingReminderDedupKey('m1', 's1', '1h')).not.toBe(
      meetingReminderDedupKey('m1', 's1', '24h'),
    )
  })

  it('returns Hebrew notification copy for both reminder kinds', () => {
    expect(buildMeetingReminderNotificationCopy('24h').title).toContain('24')
    expect(buildMeetingReminderNotificationCopy('1h').title).toContain('שעה')
    expect(buildMeetingReminderNotificationCopy('24h').message).toMatch(/פגישה/)
  })
})
