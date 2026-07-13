import type { PrimaryRole } from '../types/user'
import {
  MEETING_DURATIONS_MINUTES,
  MEETING_MAX_SLOTS,
  MEETING_MIN_SLOTS,
  MEETING_STATES,
  type MeetingCalendarRole,
  type MeetingDurationMinutes,
  type MeetingParticipantContext,
  type MeetingState,
  type ProposedMeetingSlotInput,
} from '../types/meetingCalendar'

const MEETING_CALENDAR_ROLES: MeetingCalendarRole[] = [
  'teacher',
  'secretary',
  'institution_manager',
]

export const MEETING_STATE_TRANSITIONS: Readonly<Record<MeetingState, readonly MeetingState[]>> = {
  WAITING_FOR_OWNER_APPROVAL: ['WAITING_FOR_SLOT_PROPOSAL', 'CANCELLED'],
  WAITING_FOR_SLOT_PROPOSAL: ['WAITING_FOR_SLOT_SELECTION', 'CANCELLED'],
  WAITING_FOR_SLOT_SELECTION: ['WAITING_FOR_FINAL_CONFIRMATION', 'CANCELLED'],
  WAITING_FOR_FINAL_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
  CANCELLED: [],
  COMPLETED: [],
}

export const MEETING_CREATION_MATRIX = [
  { initiator: 'teacher', recipient: 'institution_manager', allowed: true },
  { initiator: 'teacher', recipient: 'secretary', allowed: true },
  { initiator: 'secretary', recipient: 'teacher', allowed: true },
  { initiator: 'secretary', recipient: 'institution_manager', allowed: true },
  { initiator: 'institution_manager', recipient: 'teacher', allowed: true },
  { initiator: 'institution_manager', recipient: 'secretary', allowed: true },
  { initiator: 'teacher', recipient: 'teacher', allowed: false },
  { initiator: 'secretary', recipient: 'secretary', allowed: false },
  { initiator: 'institution_manager', recipient: 'institution_manager', allowed: false },
] as const

export const MEETING_SLOT_PROPOSAL_MATRIX = [
  { pair: 'manager_teacher', authorizedRole: 'institution_manager' },
  { pair: 'secretary_teacher', authorizedRole: 'secretary' },
  { pair: 'manager_secretary', authorizedRole: 'institution_manager' },
] as const

export const MEETING_SLOT_SELECTION_MATRIX = [
  { pair: 'manager_teacher', authorizedRole: 'teacher' },
  { pair: 'secretary_teacher', authorizedRole: 'teacher' },
  { pair: 'manager_secretary', authorizedRole: 'secretary' },
] as const

export const MEETING_CANCELLATION_MATRIX = [
  { pair: 'manager_teacher', authorizedRole: 'institution_manager' },
  { pair: 'secretary_teacher', authorizedRole: 'secretary' },
  { pair: 'manager_secretary', authorizedRole: 'institution_manager' },
] as const

export const MEETING_RESCHEDULING_MATRIX = [
  { pair: 'manager_teacher', authorizedRole: 'institution_manager' },
  { pair: 'secretary_teacher', authorizedRole: 'secretary' },
  { pair: 'manager_secretary', authorizedRole: 'institution_manager' },
] as const

export function isMeetingState(value: string): value is MeetingState {
  return (MEETING_STATES as readonly string[]).includes(value)
}

export function isMeetingDurationMinutes(value: number): value is MeetingDurationMinutes {
  return (MEETING_DURATIONS_MINUTES as readonly number[]).includes(value)
}

export function isMeetingCalendarRole(role: PrimaryRole): role is MeetingCalendarRole {
  return (MEETING_CALENDAR_ROLES as readonly string[]).includes(role)
}

export function canTransitionMeetingState(from: MeetingState, to: MeetingState): boolean {
  return MEETING_STATE_TRANSITIONS[from].includes(to)
}

export function isAllowedMeetingRolePair(
  requesterRole: MeetingCalendarRole,
  recipientRole: MeetingCalendarRole,
): boolean {
  if (requesterRole === recipientRole) {
    return false
  }

  if (requesterRole === 'teacher') {
    return recipientRole === 'secretary' || recipientRole === 'institution_manager'
  }

  if (requesterRole === 'secretary') {
    return recipientRole === 'teacher' || recipientRole === 'institution_manager'
  }

  return recipientRole === 'teacher' || recipientRole === 'secretary'
}

export function resolveCalendarOwnerUserId(input: {
  requesterId: string
  recipientId: string
  requesterRole: MeetingCalendarRole
  recipientRole: MeetingCalendarRole
}): string {
  if (
    input.requesterRole === 'institution_manager' ||
    input.recipientRole === 'institution_manager'
  ) {
    return input.requesterRole === 'institution_manager' ? input.requesterId : input.recipientId
  }

  if (input.requesterRole === 'secretary' || input.recipientRole === 'secretary') {
    return input.requesterRole === 'secretary' ? input.requesterId : input.recipientId
  }

  throw new Error('Unsupported participant combination.')
}

export function resolveNonOwnerParticipantId(input: {
  requesterId: string
  recipientId: string
  calendarOwnerId: string
}): string {
  return input.calendarOwnerId === input.requesterId ? input.recipientId : input.requesterId
}

export function buildMeetingParticipantContext(input: {
  requesterId: string
  recipientId: string
  requesterRole: MeetingCalendarRole
  recipientRole: MeetingCalendarRole
}): MeetingParticipantContext {
  const calendarOwnerId = resolveCalendarOwnerUserId(input)

  return {
    requesterId: input.requesterId,
    recipientId: input.recipientId,
    requesterRole: input.requesterRole,
    recipientRole: input.recipientRole,
    calendarOwnerId,
    nonOwnerParticipantId: resolveNonOwnerParticipantId({
      requesterId: input.requesterId,
      recipientId: input.recipientId,
      calendarOwnerId,
    }),
  }
}

export function resolveInitialMeetingState(input: {
  requesterId: string
  calendarOwnerId: string
}): MeetingState {
  return input.requesterId === input.calendarOwnerId
    ? 'WAITING_FOR_SLOT_PROPOSAL'
    : 'WAITING_FOR_OWNER_APPROVAL'
}

export function canActorProposeSlots(input: {
  actorUserId: string
  actorRole: MeetingCalendarRole
  context: MeetingParticipantContext
}): boolean {
  return (
    input.actorUserId === input.context.calendarOwnerId &&
    input.actorRole === roleForUserInContext(input.context, input.context.calendarOwnerId)
  )
}

export function canActorSelectAndConfirmSlot(input: {
  actorUserId: string
  actorRole: MeetingCalendarRole
  context: MeetingParticipantContext
  slotSelectedByUserId?: string | null
}): boolean {
  if (input.actorUserId !== input.context.nonOwnerParticipantId) {
    return false
  }

  if (
    input.slotSelectedByUserId !== undefined &&
    input.slotSelectedByUserId !== input.actorUserId
  ) {
    return false
  }

  return input.actorRole === roleForUserInContext(input.context, input.context.nonOwnerParticipantId)
}

export function canActorCancelMeeting(input: {
  actorUserId: string
  actorRole: MeetingCalendarRole
  context: MeetingParticipantContext
}): boolean {
  return (
    input.actorUserId === input.context.calendarOwnerId &&
    input.actorRole === roleForUserInContext(input.context, input.context.calendarOwnerId)
  )
}

export function canActorRescheduleMeeting(input: {
  actorUserId: string
  actorRole: MeetingCalendarRole
  context: MeetingParticipantContext
}): boolean {
  return canActorProposeSlots(input)
}

export function roleForUserInContext(
  context: MeetingParticipantContext,
  userId: string,
): MeetingCalendarRole {
  if (userId === context.requesterId) {
    return context.requesterRole
  }

  return context.recipientRole
}

export function pairKeyForRoles(
  roleA: MeetingCalendarRole,
  roleB: MeetingCalendarRole,
): 'manager_teacher' | 'secretary_teacher' | 'manager_secretary' | null {
  const roles = new Set([roleA, roleB])

  if (roles.has('institution_manager') && roles.has('teacher')) {
    return 'manager_teacher'
  }

  if (roles.has('secretary') && roles.has('teacher')) {
    return 'secretary_teacher'
  }

  if (roles.has('institution_manager') && roles.has('secretary')) {
    return 'manager_secretary'
  }

  return null
}

export function validateProposedMeetingSlots(input: {
  slots: ProposedMeetingSlotInput[]
  durationMinutes: MeetingDurationMinutes
  now?: Date
}): string | null {
  const now = input.now ?? new Date()

  if (input.slots.length < MEETING_MIN_SLOTS || input.slots.length > MEETING_MAX_SLOTS) {
    return `יש להציע בין ${MEETING_MIN_SLOTS} ל-${MEETING_MAX_SLOTS} זמנים בלבד.`
  }

  const seen = new Set<string>()

  for (const slot of input.slots) {
    const startsAt = new Date(slot.startsAt)
    const endsAt = new Date(slot.endsAt)

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return 'טווח הזמן שהוזן אינו תקין.'
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
      return 'שעת הסיום חייבת להיות אחרי שעת ההתחלה.'
    }

    if (startsAt.getTime() < now.getTime()) {
      return 'לא ניתן להציע זמנים בעבר.'
    }

    const durationMinutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)
    if (durationMinutes !== input.durationMinutes) {
      return 'משך כל זמן מוצע חייב להתאים למשך הפגישה.'
    }

    const key = `${slot.startsAt}|${slot.endsAt}`
    if (seen.has(key)) {
      return 'לא ניתן להציע אותו זמן פעמיים.'
    }

    seen.add(key)
  }

  return null
}

export function canCompleteConcurrentConfirmation(input: {
  currentState: MeetingState
  pendingSlotId: string | null
  alreadyConfirmed: boolean
}): boolean {
  if (input.alreadyConfirmed) {
    return false
  }

  return input.currentState === 'WAITING_FOR_FINAL_CONFIRMATION' && input.pendingSlotId !== null
}
