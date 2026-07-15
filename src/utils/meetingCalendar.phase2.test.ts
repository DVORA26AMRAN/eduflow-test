import { describe, expect, it } from 'vitest'
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
  it('rejects missing recipient/subject/reason and overly long values', () => {
    expect(
      validateCreateMeetingForm({
        recipientId: '',
        subject: 'נושא',
        reason: 'סיבה',
        durationMinutes: 30,
        requireDuration: true,
      }).ok,
    ).toBe(false)

    expect(
      validateCreateMeetingForm({
        recipientId: 's1',
        subject: '',
        reason: 'סיבה',
        durationMinutes: 30,
        requireDuration: true,
      }).ok,
    ).toBe(false)

    expect(
      validateCreateMeetingForm({
        recipientId: 's1',
        subject: 'א'.repeat(151),
        reason: 'סיבה',
        durationMinutes: 30,
        requireDuration: true,
      }).ok,
    ).toBe(false)

    expect(
      validateCreateMeetingForm({
        recipientId: 's1',
        subject: 'נושא',
        reason: 'ב'.repeat(1001),
        durationMinutes: 30,
        requireDuration: true,
      }).ok,
    ).toBe(false)
  })

  it('requires duration for owner-initiated creates only', () => {
    expect(
      validateCreateMeetingForm({
        recipientId: 't1',
        subject: 'נושא',
        reason: 'סיבה',
        durationMinutes: null,
        requireDuration: true,
      }).ok,
    ).toBe(false)

    expect(
      validateCreateMeetingForm({
        recipientId: 'm1',
        subject: 'נושא',
        reason: 'סיבה',
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
