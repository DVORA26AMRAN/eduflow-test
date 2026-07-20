import type { PrimaryRole } from './user'

export const MEETING_CALENDAR_MODULE_NAME = 'Meeting Calendar'

export const MEETING_DURATIONS_MINUTES = [15, 30, 45, 60] as const
export type MeetingDurationMinutes = (typeof MEETING_DURATIONS_MINUTES)[number]

export const MEETING_MIN_SLOTS = 1
export const MEETING_MAX_SLOTS = 5

export const MEETING_STATES = [
  'WAITING_FOR_OWNER_APPROVAL',
  'WAITING_FOR_SLOT_PROPOSAL',
  'WAITING_FOR_SLOT_SELECTION',
  'WAITING_FOR_FINAL_CONFIRMATION',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
] as const
export type MeetingState = (typeof MEETING_STATES)[number]

export const MEETING_SLOT_STATUSES = [
  'proposed',
  'selected',
  'confirmed',
  'superseded',
  'rejected',
  'expired',
] as const
export type MeetingSlotStatus = (typeof MEETING_SLOT_STATUSES)[number]

export const MEETING_AUDIT_EVENT_TYPES = [
  'meeting_created',
  'state_changed',
  'slot_proposed',
  'slot_selected',
  'meeting_confirmed',
  'meeting_cancelled',
  'meeting_rescheduled',
] as const
export type MeetingAuditEventType = (typeof MEETING_AUDIT_EVENT_TYPES)[number]

export type MeetingCalendarRole = Exclude<PrimaryRole, 'platform_admin'>

export type Meeting = {
  id: string
  institutionId: string
  creatorId: string
  requesterId: string
  calendarOwnerId: string
  recipientId: string
  subject: string
  reason: string
  durationMinutes: MeetingDurationMinutes | null
  institutionTimezone: string
  currentState: MeetingState
  activeProposalCycle: number
  reschedulingActive: boolean
  reschedulingInitiatedAt: string | null
  reschedulingInitiatedByUserId: string | null
  confirmedSlotId: string | null
  pendingSlotId: string | null
  slotSelectedByUserId: string | null
  /** Populated by pending-list RPC; used to classify reschedule overlay stages. */
  activeProposedSlotCount?: number | null
  createdAt: string
  updatedAt: string
}

export type MeetingSlot = {
  id: string
  meetingId: string
  institutionId: string
  proposalCycle: number
  startsAt: string
  endsAt: string
  slotStatus: MeetingSlotStatus
  createdByUserId: string
  createdAt: string
}

export type MeetingAuditEvent = {
  id: string
  meetingId: string
  institutionId: string
  actorUserId: string
  eventType: MeetingAuditEventType
  fromState: MeetingState | null
  toState: MeetingState | null
  proposalCycle: number | null
  slotId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type ProposedMeetingSlotInput = {
  startsAt: string
  endsAt: string
}

export type CreateMeetingInput = {
  recipientId: string
  subject: string
  reason: string
  durationMinutes: MeetingDurationMinutes | null
  institutionTimezone?: string
}

export type MeetingCommandResult =
  | { ok: true; meetingId?: string; currentState: MeetingState; reschedulingActive?: boolean }
  | { ok: false; errorMessage: string }

export type MeetingParticipantContext = {
  requesterId: string
  recipientId: string
  requesterRole: MeetingCalendarRole
  recipientRole: MeetingCalendarRole
  calendarOwnerId: string
  nonOwnerParticipantId: string
}
