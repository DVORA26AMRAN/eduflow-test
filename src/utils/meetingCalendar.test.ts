import { describe, expect, it } from 'vitest'
import {
  isMeetingDurationMinutes,
  resolveCalendarOwnerUserId,
  resolveInitialMeetingState,
  validateProposedMeetingSlots,
} from './meetingCalendar'

describe('meetingCalendar utils', () => {
  it('accepts only allowed meeting durations', () => {
    expect(isMeetingDurationMinutes(30)).toBe(true)
    expect(isMeetingDurationMinutes(20)).toBe(false)
  })

  it('rejects duplicate and past slots', () => {
    const now = new Date('2026-07-13T10:00:00.000Z')

    expect(
      validateProposedMeetingSlots({
        durationMinutes: 30,
        now,
        slots: [
          { startsAt: '2026-07-13T11:00:00.000Z', endsAt: '2026-07-13T11:30:00.000Z' },
          { startsAt: '2026-07-13T11:00:00.000Z', endsAt: '2026-07-13T11:30:00.000Z' },
        ],
      }),
    ).toContain('פעמיים')

    expect(
      validateProposedMeetingSlots({
        durationMinutes: 30,
        now,
        slots: [{ startsAt: '2026-07-13T09:00:00.000Z', endsAt: '2026-07-13T09:30:00.000Z' }],
      }),
    ).toContain('בעבר')
  })

  it('derives manager ownership for teacher -> manager requests', () => {
    expect(
      resolveCalendarOwnerUserId({
        requesterId: 'teacher-1',
        recipientId: 'manager-1',
        requesterRole: 'teacher',
        recipientRole: 'institution_manager',
      }),
    ).toBe('manager-1')

    expect(
      resolveInitialMeetingState({
        requesterId: 'teacher-1',
        calendarOwnerId: 'manager-1',
      }),
    ).toBe('WAITING_FOR_OWNER_APPROVAL')
  })
})
