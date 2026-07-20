import type { MeetingCalendarRole, Meeting, MeetingSlot, MeetingState } from '../types/meetingCalendar'
import { isAllowedMeetingRolePair, isMeetingCalendarRole } from './meetingCalendar'
import { translateRole } from './roles'

export const MEETING_CALENDAR_SECTION_ID = 'meetingCalendar'
export const MEETING_CALENDAR_NAV_LABEL = 'יומן פגישות'
export const MEETING_SUBJECT_MAX_LENGTH = 150
export const MEETING_REASON_MAX_LENGTH = 1000

export type MeetingPendingBucket =
  | 'waiting_for_my_approval'
  | 'waiting_for_me_to_propose'
  | 'waiting_for_me_to_choose'
  | 'waiting_for_my_final_confirmation'
  | 'waiting_for_other'
  | 'confirmed'

export type MeetingUserDirectoryEntry = {
  id: string
  fullName: string
  primaryRole: MeetingCalendarRole
  status: string
}

const STATE_LABELS: Record<MeetingState, string> = {
  WAITING_FOR_OWNER_APPROVAL: 'ממתין לאישור בעל היומן',
  WAITING_FOR_SLOT_PROPOSAL: 'ממתין להצעת מועדים',
  WAITING_FOR_SLOT_SELECTION: 'ממתין לבחירת מועד',
  WAITING_FOR_FINAL_CONFIRMATION: 'ממתין לאישור סופי',
  CONFIRMED: 'פגישה מאושרת',
  CANCELLED: 'פגישה בוטלה',
  COMPLETED: 'פגישה הושלמה',
}

const BUCKET_LABELS: Record<MeetingPendingBucket, string> = {
  waiting_for_my_approval: 'מבקשים לתאם איתך פגישה',
  waiting_for_me_to_propose: 'ממתין להצעת מועדים ממך',
  waiting_for_me_to_choose: 'ממתין לבחירת מועד ממך',
  waiting_for_my_final_confirmation: 'ממתין לאישור סופי ממך',
  waiting_for_other: 'ממתין למשתתף השני',
  confirmed: 'פגישות מאושרות',
}

export function translateMeetingState(state: MeetingState): string {
  return STATE_LABELS[state]
}

export function translateMeetingPendingBucket(bucket: MeetingPendingBucket): string {
  return BUCKET_LABELS[bucket]
}

export function translateMeetingDuration(minutes: number | null): string {
  if (minutes === null) {
    return 'טרם נקבע'
  }
  return `${minutes} דקות`
}

export function isRequesterCalendarOwner(meeting: Meeting, actorUserId: string): boolean {
  return meeting.requesterId === actorUserId && meeting.calendarOwnerId === actorUserId
}

export function willRequesterBeCalendarOwner(
  requesterRole: MeetingCalendarRole,
  recipientRole: MeetingCalendarRole,
): boolean {
  if (requesterRole === 'institution_manager' || recipientRole === 'institution_manager') {
    return requesterRole === 'institution_manager'
  }
  if (requesterRole === 'secretary' || recipientRole === 'secretary') {
    return requesterRole === 'secretary'
  }
  return false
}

export function filterEligibleMeetingRecipients(
  users: MeetingUserDirectoryEntry[],
  actorUserId: string,
  actorRole: MeetingCalendarRole,
): MeetingUserDirectoryEntry[] {
  return users.filter((user) => {
    if (user.id === actorUserId) {
      return false
    }
    if (user.status !== 'active') {
      return false
    }
    if (!isMeetingCalendarRole(user.primaryRole)) {
      return false
    }
    return isAllowedMeetingRolePair(actorRole, user.primaryRole)
  })
}

export function searchMeetingRecipients(
  users: MeetingUserDirectoryEntry[],
  query: string,
): MeetingUserDirectoryEntry[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return users
  }
  return users.filter((user) => user.fullName.toLowerCase().includes(normalized))
}

export function resolveOtherParticipantId(meeting: Meeting, actorUserId: string): string {
  if (meeting.requesterId === actorUserId) {
    return meeting.recipientId
  }
  return meeting.requesterId
}

export function getMeetingParticipantLabel(
  directory: Map<string, MeetingUserDirectoryEntry>,
  userId: string,
): string {
  const entry = directory.get(userId)
  if (!entry) {
    return 'משתתף'
  }
  return `${entry.fullName} (${translateRole(entry.primaryRole)})`
}

export type MeetingRescheduleStage =
  | 'awaiting_proposal'
  | 'awaiting_selection'
  | 'awaiting_confirmation'
  | null

/**
 * Reschedule overlay stages while current_state remains CONFIRMED.
 * Progress is represented by rescheduling_active + pending_slot_id + proposed slots.
 */
export function getMeetingRescheduleStage(
  meeting: Pick<
    Meeting,
    'currentState' | 'reschedulingActive' | 'pendingSlotId' | 'activeProposedSlotCount'
  >,
  activeProposedSlotCount?: number | null,
): MeetingRescheduleStage {
  if (meeting.currentState !== 'CONFIRMED' || !meeting.reschedulingActive) {
    return null
  }

  if (meeting.pendingSlotId) {
    return 'awaiting_confirmation'
  }

  const proposedCount = activeProposedSlotCount ?? meeting.activeProposedSlotCount ?? 0
  if (proposedCount > 0) {
    return 'awaiting_selection'
  }

  return 'awaiting_proposal'
}

export function classifyMeetingPendingBucket(
  meeting: Meeting,
  actorUserId: string,
): MeetingPendingBucket | null {
  if (meeting.currentState === 'CANCELLED' || meeting.currentState === 'COMPLETED') {
    return null
  }

  if (meeting.currentState === 'CONFIRMED' && meeting.reschedulingActive) {
    const stage = getMeetingRescheduleStage(meeting)
    const isOwner = meeting.calendarOwnerId === actorUserId

    if (stage === 'awaiting_confirmation') {
      if (meeting.slotSelectedByUserId === actorUserId) {
        return 'waiting_for_my_final_confirmation'
      }
      return 'waiting_for_other'
    }

    if (stage === 'awaiting_selection') {
      if (isOwner) {
        return 'waiting_for_other'
      }
      return 'waiting_for_me_to_choose'
    }

    if (isOwner) {
      return 'waiting_for_me_to_propose'
    }
    return 'waiting_for_other'
  }

  if (meeting.currentState === 'CONFIRMED' && !meeting.reschedulingActive) {
    return 'confirmed'
  }

  if (
    meeting.currentState === 'WAITING_FOR_OWNER_APPROVAL' &&
    meeting.calendarOwnerId === actorUserId
  ) {
    return 'waiting_for_my_approval'
  }

  if (
    meeting.currentState === 'WAITING_FOR_SLOT_PROPOSAL' &&
    meeting.calendarOwnerId === actorUserId
  ) {
    return 'waiting_for_me_to_propose'
  }

  if (meeting.currentState === 'WAITING_FOR_SLOT_SELECTION') {
    const isNonOwner =
      actorUserId === meeting.requesterId || actorUserId === meeting.recipientId
        ? actorUserId !== meeting.calendarOwnerId
        : false
    if (isNonOwner) {
      return 'waiting_for_me_to_choose'
    }
  }

  if (
    meeting.currentState === 'WAITING_FOR_FINAL_CONFIRMATION' &&
    meeting.slotSelectedByUserId === actorUserId
  ) {
    return 'waiting_for_my_final_confirmation'
  }

  if (
    actorUserId === meeting.requesterId ||
    actorUserId === meeting.recipientId ||
    actorUserId === meeting.calendarOwnerId
  ) {
    return 'waiting_for_other'
  }

  return null
}

export function groupMeetingsByPendingBucket(
  meetings: Meeting[],
  actorUserId: string,
): Record<MeetingPendingBucket, Meeting[]> {
  const groups: Record<MeetingPendingBucket, Meeting[]> = {
    waiting_for_my_approval: [],
    waiting_for_me_to_propose: [],
    waiting_for_me_to_choose: [],
    waiting_for_my_final_confirmation: [],
    waiting_for_other: [],
    confirmed: [],
  }

  for (const meeting of meetings) {
    const bucket = classifyMeetingPendingBucket(meeting, actorUserId)
    if (bucket) {
      groups[bucket].push(meeting)
    }
  }

  return groups
}

export function formatMeetingSlotRange(slot: MeetingSlot, timeZone = 'Asia/Jerusalem'): string {
  const start = new Date(slot.startsAt)
  const end = new Date(slot.endsAt)
  const dateFormatter = new Intl.DateTimeFormat('he-IL', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const timeFormatter = new Intl.DateTimeFormat('he-IL', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${dateFormatter.format(start)} · ${timeFormatter.format(start)}–${timeFormatter.format(end)}`
}

export function mapMeetingCalendarError(rawMessage: string | null | undefined): string {
  if (!rawMessage) {
    return 'לא ניתן להשלים את הפעולה. נסו שוב'
  }

  const message = rawMessage.toLowerCase()

  if (
    message.includes('unauthorized role combination') ||
    message.includes('unsupported participant') ||
    message.includes('recipient is not an active')
  ) {
    return 'המשתמש שנבחר אינו זמין לתיאום פגישה'
  }

  if (
    message.includes('permission denied') ||
    message.includes('unauthorized') ||
    message.includes('42501') ||
    message.includes('only the')
  ) {
    return 'אין הרשאה לבצע פעולה זו'
  }

  if (message.includes('cancellation reason exceeds')) {
    return 'סיבת הביטול ארוכה מדי (עד 500 תווים)'
  }

  if (
    message.includes('proposed slot not found') ||
    message.includes('not valid for the active proposal') ||
    message.includes('missing a pending selected slot')
  ) {
    return 'המועד שנבחר כבר אינו זמין'
  }

  if (message.includes('conflicts with another confirmed')) {
    return 'קיימת פגישה אחרת בזמן זה'
  }

  if (
    message.includes('invalid meeting state') ||
    message.includes('not awaiting') ||
    message.includes('can only be')
  ) {
    return 'מצב הפגישה השתנה. רעננו את הרשימה ונסו שוב'
  }

  return 'לא ניתן להשלים את הפעולה. נסו שוב'
}
