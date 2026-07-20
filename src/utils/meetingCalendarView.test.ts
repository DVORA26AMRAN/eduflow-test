import { describe, expect, it } from 'vitest'
import type { Meeting, MeetingSlot } from '../types/meetingCalendar'
import type { MeetingUserDirectoryEntry } from './meetingCalendarDisplay'
import {
  buildConfirmedCalendarEvents,
  buildMonthDayCells,
  buildPhase3PendingPanels,
  buildWeekDayCells,
  filterEventsForVisibleRange,
  getVisibleCalendarRange,
  shiftCalendarAnchor,
  toDateKey,
} from './meetingCalendarView'

function meeting(partial: Partial<Meeting> & Pick<Meeting, 'id' | 'currentState'>): Meeting {
  return {
    institutionId: 'inst-1',
    creatorId: 'u1',
    requesterId: 'u1',
    calendarOwnerId: 'u1',
    recipientId: 'u2',
    subject: 'פגישה',
    reason: 'תיאום',
    durationMinutes: 30,
    institutionTimezone: 'Asia/Jerusalem',
    activeProposalCycle: 1,
    reschedulingActive: false,
    reschedulingInitiatedAt: null,
    reschedulingInitiatedByUserId: null,
    confirmedSlotId: null,
    pendingSlotId: null,
    slotSelectedByUserId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...partial,
  }
}

describe('meetingCalendarView', () => {
  it('builds a month grid covering full weeks around the anchor month', () => {
    const cells = buildMonthDayCells(new Date(2026, 6, 15), new Date(2026, 6, 19))
    expect(cells).toHaveLength(35)
    expect(cells[0]?.date.getDay()).toBe(0)
    expect(cells.some((cell) => cell.isToday)).toBe(true)
  })

  it('builds a week grid of seven days starting on Sunday', () => {
    const cells = buildWeekDayCells(new Date(2026, 6, 15), new Date(2026, 6, 15))
    expect(cells).toHaveLength(7)
    expect(cells[0]?.date.getDay()).toBe(0)
    expect(cells[3]?.isToday).toBe(true)
  })

  it('navigates previous and next periods for month and week', () => {
    const july = new Date(2026, 6, 10)
    expect(shiftCalendarAnchor(july, 'month', 1).getMonth()).toBe(7)
    expect(shiftCalendarAnchor(july, 'month', -1).getMonth()).toBe(5)

    const weekStart = shiftCalendarAnchor(july, 'week', 1)
    expect(toDateKey(weekStart)).toBe('2026-07-12')
  })

  it('builds confirmed calendar events only and filters by visible range', () => {
    const directory = new Map<string, MeetingUserDirectoryEntry>([
      [
        'u2',
        {
          id: 'u2',
          fullName: 'יעל',
          primaryRole: 'teacher',
          status: 'active',
        },
      ],
    ])
    const slotsById = new Map<string, MeetingSlot>([
      [
        'slot-1',
        {
          id: 'slot-1',
          meetingId: 'm1',
          institutionId: 'inst-1',
          proposalCycle: 1,
          startsAt: '2026-07-20T09:00:00.000Z',
          endsAt: '2026-07-20T09:30:00.000Z',
          slotStatus: 'confirmed',
          createdByUserId: 'u1',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    ])

    const events = buildConfirmedCalendarEvents({
      meetings: [
        meeting({
          id: 'm1',
          currentState: 'CONFIRMED',
          confirmedSlotId: 'slot-1',
        }),
        meeting({
          id: 'm2',
          currentState: 'WAITING_FOR_SLOT_PROPOSAL',
        }),
      ],
      slotsById,
      directory,
      actorUserId: 'u1',
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.participantName).toBe('יעל')

    const { rangeStart, rangeEnd } = getVisibleCalendarRange(new Date(2026, 6, 1), 'month')
    expect(filterEventsForVisibleRange(events, rangeStart, rangeEnd)).toHaveLength(1)
    expect(
      filterEventsForVisibleRange(events, new Date(2026, 7, 1), new Date(2026, 8, 1)),
    ).toHaveLength(0)
  })

  it('keeps confirmed meetings on the calendar during active rescheduling while state stays CONFIRMED', () => {
    const directory = new Map<string, MeetingUserDirectoryEntry>([
      [
        'u2',
        {
          id: 'u2',
          fullName: 'יעל',
          primaryRole: 'teacher',
          status: 'active',
        },
      ],
    ])
    const slotsById = new Map<string, MeetingSlot>([
      [
        'slot-1',
        {
          id: 'slot-1',
          meetingId: 'm1',
          institutionId: 'inst-1',
          proposalCycle: 1,
          startsAt: '2026-07-20T09:00:00.000Z',
          endsAt: '2026-07-20T09:30:00.000Z',
          slotStatus: 'confirmed',
          createdByUserId: 'u1',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    ])

    const events = buildConfirmedCalendarEvents({
      meetings: [
        meeting({
          id: 'm1',
          currentState: 'CONFIRMED',
          reschedulingActive: true,
          confirmedSlotId: 'slot-1',
          pendingSlotId: null,
          activeProposedSlotCount: 2,
        }),
        meeting({
          id: 'm2',
          currentState: 'CANCELLED',
          confirmedSlotId: 'slot-1',
        }),
        meeting({
          id: 'm3',
          currentState: 'WAITING_FOR_SLOT_SELECTION',
          reschedulingActive: true,
          confirmedSlotId: 'slot-1',
        }),
      ],
      slotsById,
      directory,
      actorUserId: 'u1',
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.meetingId).toBe('m1')
  })

  it('excludes cancelled meetings from calendar events', () => {
    const directory = new Map<string, MeetingUserDirectoryEntry>()
    const slotsById = new Map<string, MeetingSlot>([
      [
        'slot-1',
        {
          id: 'slot-1',
          meetingId: 'm1',
          institutionId: 'inst-1',
          proposalCycle: 1,
          startsAt: '2026-07-20T09:00:00.000Z',
          endsAt: '2026-07-20T09:30:00.000Z',
          slotStatus: 'confirmed',
          createdByUserId: 'u1',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    ])

    const events = buildConfirmedCalendarEvents({
      meetings: [
        meeting({
          id: 'm1',
          currentState: 'CANCELLED',
          confirmedSlotId: 'slot-1',
        }),
      ],
      slotsById,
      directory,
      actorUserId: 'u1',
    })

    expect(events).toHaveLength(0)
  })

  it('builds phase 3 pending panels including upcoming confirmed meetings', () => {
    const pending = [
      meeting({
        id: 'pending',
        currentState: 'WAITING_FOR_OWNER_APPROVAL',
        calendarOwnerId: 'owner',
        requesterId: 'teacher',
        recipientId: 'owner',
      }),
    ]
    const upcoming = [
      meeting({
        id: 'upcoming',
        currentState: 'CONFIRMED',
        confirmedSlotId: 'slot-1',
        calendarOwnerId: 'owner',
        requesterId: 'owner',
        recipientId: 'teacher',
      }),
    ]

    const panels = buildPhase3PendingPanels({
      pendingMeetings: pending,
      upcomingMeetings: upcoming,
      actorUserId: 'owner',
    })

    expect(panels.waiting_for_my_approval.map((item) => item.id)).toEqual(['pending'])
    expect(panels.upcoming.map((item) => item.id)).toEqual(['upcoming'])
  })
})
