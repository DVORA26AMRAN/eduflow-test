import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  classifyMeetingPendingBucket,
  filterEligibleMeetingRecipients,
  mapMeetingCalendarError,
  searchMeetingRecipients,
  translateMeetingDuration,
  willRequesterBeCalendarOwner,
  type MeetingUserDirectoryEntry,
} from './meetingCalendarDisplay'
import {
  createEmptySlotDraft,
  draftSlotsToProposedInputs,
  validateCreateMeetingForm,
} from './meetingCalendarForm'
import type { Meeting } from '../types/meetingCalendar'
import { formatEventTimeRange } from './meetingCalendarView'

const directory: MeetingUserDirectoryEntry[] = [
  { id: 't1', fullName: 'יעל מורה', primaryRole: 'teacher', status: 'active' },
  { id: 't2', fullName: 'דני מורה', primaryRole: 'teacher', status: 'active' },
  { id: 's1', fullName: 'רותי מזכירה', primaryRole: 'secretary', status: 'active' },
  { id: 'm1', fullName: 'נועה מנהלת', primaryRole: 'institution_manager', status: 'active' },
  { id: 'inactive', fullName: 'לא פעילה', primaryRole: 'secretary', status: 'inactive' },
]

function baseMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meeting-1',
    institutionId: 'inst-1',
    creatorId: 't1',
    requesterId: 't1',
    calendarOwnerId: 'm1',
    recipientId: 'm1',
    subject: 'שיחה',
    reason: 'תיאום',
    durationMinutes: 30,
    institutionTimezone: 'Asia/Jerusalem',
    currentState: 'WAITING_FOR_OWNER_APPROVAL',
    activeProposalCycle: 1,
    reschedulingActive: false,
    reschedulingInitiatedAt: null,
    reschedulingInitiatedByUserId: null,
    confirmedSlotId: null,
    pendingSlotId: null,
    slotSelectedByUserId: null,
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    ...overrides,
  }
}

describe('meeting calendar recipient filtering', () => {
  it('shows only active same-institution eligible roles and hides self/same-role', () => {
    const recipients = filterEligibleMeetingRecipients(directory, 't1', 'teacher')
    expect(recipients.map((user) => user.id).sort()).toEqual(['m1', 's1'])
  })

  it('hides unsupported and inactive users', () => {
    const recipients = filterEligibleMeetingRecipients(directory, 'm1', 'institution_manager')
    expect(recipients.some((user) => user.id === 'inactive')).toBe(false)
    expect(recipients.some((user) => user.id === 'm1')).toBe(false)
  })

  it('supports name search', () => {
    const recipients = filterEligibleMeetingRecipients(directory, 't1', 'teacher')
    expect(searchMeetingRecipients(recipients, 'רותי').map((user) => user.id)).toEqual(['s1'])
  })
})

describe('meeting calendar ownership prediction', () => {
  it('predicts workflow A and B ownership consistently with Phase 1', () => {
    expect(willRequesterBeCalendarOwner('institution_manager', 'teacher')).toBe(true)
    expect(willRequesterBeCalendarOwner('teacher', 'institution_manager')).toBe(false)
    expect(willRequesterBeCalendarOwner('secretary', 'teacher')).toBe(true)
    expect(willRequesterBeCalendarOwner('teacher', 'secretary')).toBe(false)
    expect(willRequesterBeCalendarOwner('secretary', 'institution_manager')).toBe(false)
  })
})

describe('create meeting form validation', () => {
  const baseFields = {
    recipientId: 's1',
    subject: 'נושא',
    reason: 'סיבה',
    durationMinutes: 30 as number | null,
    requireDuration: true,
    meetingFormat: 'in_person' as const,
    phoneNumber: '',
  }

  it('rejects missing recipient/subject/reason and overly long values', () => {
    expect(validateCreateMeetingForm({ ...baseFields, recipientId: '' }).ok).toBe(false)
    expect(validateCreateMeetingForm({ ...baseFields, subject: '' }).ok).toBe(false)
    expect(validateCreateMeetingForm({ ...baseFields, subject: 'א'.repeat(151) }).ok).toBe(false)
    expect(validateCreateMeetingForm({ ...baseFields, reason: 'ב'.repeat(1001) }).ok).toBe(false)
  })

  it('requires meeting type and phone number for phone meetings', () => {
    expect(
      validateCreateMeetingForm({
        ...baseFields,
        meetingFormat: null,
      }).ok,
    ).toBe(false)
    expect(
      validateCreateMeetingForm({
        ...baseFields,
        meetingFormat: 'phone',
        phoneNumber: '',
      }).ok,
    ).toBe(false)
    expect(
      validateCreateMeetingForm({
        ...baseFields,
        meetingFormat: 'phone',
        phoneNumber: '050-1234567',
      }).ok,
    ).toBe(true)
  })

  it('rejects manual Meet URL on create', () => {
    expect(
      validateCreateMeetingForm({
        ...baseFields,
        meetingFormat: 'online',
        meetUrl: 'https://meet.google.com/abc-defg-hij',
      }).ok,
    ).toBe(false)
  })

  it('requires duration for owner-initiated creates only', () => {
    expect(
      validateCreateMeetingForm({
        ...baseFields,
        durationMinutes: null,
        requireDuration: true,
      }).ok,
    ).toBe(false)

    expect(
      validateCreateMeetingForm({
        ...baseFields,
        durationMinutes: null,
        requireDuration: false,
      }).ok,
    ).toBe(true)
  })
})

describe('slot draft validation', () => {
  it('rejects zero slots, more than five slots, past slots, and duplicates', () => {
    expect(draftSlotsToProposedInputs([], 30).ok).toBe(false)

    const tooMany = Array.from({ length: 6 }, () => createEmptySlotDraft()).map((draft, index) => ({
      ...draft,
      date: '2099-01-0' + String(index + 1),
      startTime: '10:00',
    }))
    expect(draftSlotsToProposedInputs(tooMany, 30).ok).toBe(false)

    expect(
      draftSlotsToProposedInputs(
        [{ id: '1', date: '2020-01-01', startTime: '10:00' }],
        30,
      ).ok,
    ).toBe(false)

    expect(
      draftSlotsToProposedInputs(
        [
          { id: '1', date: '2099-02-01', startTime: '10:00' },
          { id: '2', date: '2099-02-01', startTime: '10:00' },
        ],
        30,
      ).ok,
    ).toBe(false)
  })

  it('accepts one to five valid future slots', () => {
    const result = draftSlotsToProposedInputs(
      [
        { id: '1', date: '2099-03-01', startTime: '09:00' },
        { id: '2', date: '2099-03-01', startTime: '11:00' },
      ],
      30,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.slots).toHaveLength(2)
    }
  })
})

describe('Israel institution production timezone flow', () => {
  const previousTimezone = process.env.TZ

  beforeAll(() => {
    process.env.TZ = 'Asia/Jerusalem'
  })

  afterAll(() => {
    process.env.TZ = previousTimezone
  })

  it('stores 15:00 Israel as 12:00Z and renders it as 15:00', () => {
    const result = draftSlotsToProposedInputs(
      [{ id: 'israel-slot', date: '2099-07-30', startTime: '15:00' }],
      30,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const storedSlot = result.slots[0]
    const productionMeeting = baseMeeting({
      institutionTimezone: 'Asia/Jerusalem',
    })

    expect(storedSlot?.startsAt).toBe('2099-07-30T12:00:00.000Z')
    expect(
      formatEventTimeRange(
        storedSlot!.startsAt,
        storedSlot!.endsAt,
        productionMeeting.institutionTimezone,
      ),
    ).toBe('15:00–15:30')
  })
})

describe('pending bucket classification', () => {
  it('classifies owner approval, proposal, selection, confirmation, and confirmed buckets', () => {
    expect(
      classifyMeetingPendingBucket(
        baseMeeting({ currentState: 'WAITING_FOR_OWNER_APPROVAL', calendarOwnerId: 'm1' }),
        'm1',
      ),
    ).toBe('waiting_for_my_approval')

    expect(
      classifyMeetingPendingBucket(
        baseMeeting({ currentState: 'WAITING_FOR_SLOT_PROPOSAL', calendarOwnerId: 'm1' }),
        'm1',
      ),
    ).toBe('waiting_for_me_to_propose')

    expect(
      classifyMeetingPendingBucket(
        baseMeeting({
          currentState: 'WAITING_FOR_SLOT_SELECTION',
          calendarOwnerId: 'm1',
          requesterId: 't1',
          recipientId: 'm1',
        }),
        't1',
      ),
    ).toBe('waiting_for_me_to_choose')

    expect(
      classifyMeetingPendingBucket(
        baseMeeting({
          currentState: 'WAITING_FOR_FINAL_CONFIRMATION',
          slotSelectedByUserId: 't1',
        }),
        't1',
      ),
    ).toBe('waiting_for_my_final_confirmation')

    expect(
      classifyMeetingPendingBucket(
        baseMeeting({ currentState: 'CONFIRMED' }),
        't1',
      ),
    ).toBe('confirmed')

    expect(
      classifyMeetingPendingBucket(
        baseMeeting({
          currentState: 'CONFIRMED',
          reschedulingActive: true,
          calendarOwnerId: 'm1',
        }),
        'm1',
      ),
    ).toBe('waiting_for_me_to_propose')

    expect(
      classifyMeetingPendingBucket(
        baseMeeting({
          currentState: 'CONFIRMED',
          reschedulingActive: true,
          calendarOwnerId: 'm1',
          requesterId: 't1',
          recipientId: 'm1',
          activeProposedSlotCount: 2,
        }),
        't1',
      ),
    ).toBe('waiting_for_me_to_choose')

    expect(
      classifyMeetingPendingBucket(
        baseMeeting({
          currentState: 'CONFIRMED',
          reschedulingActive: true,
          calendarOwnerId: 'm1',
          requesterId: 't1',
          recipientId: 'm1',
          pendingSlotId: 'slot-2',
          slotSelectedByUserId: 't1',
        }),
        't1',
      ),
    ).toBe('waiting_for_my_final_confirmation')
  })
})

describe('meeting duration display', () => {
  it('labels unset Workflow B duration until the calendar owner sets it', () => {
    expect(translateMeetingDuration(null)).toBe('טרם נקבע')
    expect(translateMeetingDuration(45)).toBe('45 דקות')
  })
})

describe('meeting calendar error mapping', () => {
  it('maps backend errors to Hebrew user messages', () => {
    expect(mapMeetingCalendarError('Permission denied.')).toBe('אין הרשאה לבצע פעולה זו')
    expect(mapMeetingCalendarError('Unauthorized role combination.')).toBe(
      'המשתמש שנבחר אינו זמין לתיאום פגישה',
    )
    expect(mapMeetingCalendarError('Proposed slot not found in the active proposal cycle.')).toBe(
      'המועד שנבחר כבר אינו זמין',
    )
    expect(mapMeetingCalendarError('Selected slot conflicts with another confirmed meeting.')).toBe(
      'קיימת פגישה אחרת בזמן זה',
    )
  })
})
