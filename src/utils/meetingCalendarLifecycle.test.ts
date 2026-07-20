import { describe, expect, it } from 'vitest'
import type { MeetingAuditEvent } from '../types/meetingCalendar'
import type { MeetingUserDirectoryEntry } from './meetingCalendarDisplay'
import { getMeetingRescheduleStage } from './meetingCalendarDisplay'
import {
  describeMeetingAuditEvent,
  extractMeetingIdFromNotificationMetadata,
  isMeetingNotificationType,
  MEETING_CANCEL_REASON_MAX_LENGTH,
  sortMeetingAuditEventsNewestFirst,
} from './meetingCalendarLifecycle'

const directory = new Map<string, MeetingUserDirectoryEntry>([
  [
    'u1',
    {
      id: 'u1',
      fullName: 'דנה',
      primaryRole: 'teacher',
      status: 'active',
    },
  ],
])

describe('meetingCalendarLifecycle', () => {
  it('sorts audit events newest first and describes cancel with reason', () => {
    const events: MeetingAuditEvent[] = [
      {
        id: '1',
        meetingId: 'm1',
        institutionId: 'i1',
        actorUserId: 'u1',
        eventType: 'meeting_created',
        fromState: null,
        toState: 'WAITING_FOR_SLOT_PROPOSAL',
        proposalCycle: 1,
        slotId: null,
        metadata: {},
        createdAt: '2026-07-01T10:00:00.000Z',
      },
      {
        id: '2',
        meetingId: 'm1',
        institutionId: 'i1',
        actorUserId: 'u1',
        eventType: 'meeting_cancelled',
        fromState: 'CONFIRMED',
        toState: 'CANCELLED',
        proposalCycle: 1,
        slotId: null,
        metadata: { reason: 'מחלה' },
        createdAt: '2026-07-03T10:00:00.000Z',
      },
    ]

    const sorted = sortMeetingAuditEventsNewestFirst(events)
    expect(sorted.map((event) => event.id)).toEqual(['2', '1'])
    expect(describeMeetingAuditEvent(sorted[0]!, directory)).toContain('בוטלה')
    expect(describeMeetingAuditEvent(sorted[0]!, directory)).toContain('מחלה')
  })

  it('recognizes meeting notification types and meeting ids in metadata', () => {
    expect(isMeetingNotificationType('MEETING_CONFIRMED')).toBe(true)
    expect(isMeetingNotificationType('REQUEST_CREATED')).toBe(false)
    expect(extractMeetingIdFromNotificationMetadata({ meeting_id: 'm9' })).toBe('m9')
    expect(extractMeetingIdFromNotificationMetadata({})).toBeNull()
    expect(MEETING_CANCEL_REASON_MAX_LENGTH).toBe(500)
  })

  it('classifies reschedule overlay stages while current_state stays CONFIRMED', () => {
    expect(
      getMeetingRescheduleStage({
        currentState: 'CONFIRMED',
        reschedulingActive: true,
        pendingSlotId: null,
        activeProposedSlotCount: 0,
      }),
    ).toBe('awaiting_proposal')

    expect(
      getMeetingRescheduleStage({
        currentState: 'CONFIRMED',
        reschedulingActive: true,
        pendingSlotId: null,
        activeProposedSlotCount: 3,
      }),
    ).toBe('awaiting_selection')

    expect(
      getMeetingRescheduleStage({
        currentState: 'CONFIRMED',
        reschedulingActive: true,
        pendingSlotId: 'slot-2',
        activeProposedSlotCount: 3,
      }),
    ).toBe('awaiting_confirmation')

    expect(
      getMeetingRescheduleStage({
        currentState: 'WAITING_FOR_SLOT_SELECTION',
        reschedulingActive: true,
        pendingSlotId: null,
        activeProposedSlotCount: 2,
      }),
    ).toBeNull()
  })
})
