import type {
  CreateMeetingInput,
  Meeting,
  MeetingAuditEvent,
  MeetingCommandResult,
  MeetingDurationMinutes,
  MeetingSlot,
  MeetingState,
  ProposedMeetingSlotInput,
} from '../types/meetingCalendar'
import {
  isMeetingDurationMinutes,
  isMeetingState,
  validateProposedMeetingSlots,
} from '../utils/meetingCalendar'
import { mapMeetingCalendarError } from '../utils/meetingCalendarDisplay'
import { supabase } from './supabase'

export type LoadMeetingsResult =
  | { ok: true; meetings: Meeting[] }
  | { ok: false; errorMessage: string }

export type LoadMeetingSlotsResult =
  | { ok: true; slots: MeetingSlot[] }
  | { ok: false; errorMessage: string }

export type LoadMeetingAuditEventsResult =
  | { ok: true; events: MeetingAuditEvent[] }
  | { ok: false; errorMessage: string }

function parseMeeting(row: Record<string, unknown>): Meeting | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.institution_id !== 'string' ||
    typeof row.creator_id !== 'string' ||
    typeof row.requester_id !== 'string' ||
    typeof row.calendar_owner_id !== 'string' ||
    typeof row.recipient_id !== 'string' ||
    typeof row.subject !== 'string' ||
    typeof row.reason !== 'string' ||
    typeof row.institution_timezone !== 'string' ||
    typeof row.current_state !== 'string' ||
    typeof row.active_proposal_cycle !== 'number' ||
    typeof row.rescheduling_active !== 'boolean' ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string' ||
    !isMeetingState(row.current_state)
  ) {
    return null
  }

  const durationMinutes =
    row.duration_minutes === null
      ? null
      : typeof row.duration_minutes === 'number' && isMeetingDurationMinutes(row.duration_minutes)
        ? row.duration_minutes
        : undefined

  if (durationMinutes === undefined) {
    return null
  }

  return {
    id: row.id,
    institutionId: row.institution_id,
    creatorId: row.creator_id,
    requesterId: row.requester_id,
    calendarOwnerId: row.calendar_owner_id,
    recipientId: row.recipient_id,
    subject: row.subject,
    reason: row.reason,
    durationMinutes,
    institutionTimezone: row.institution_timezone,
    currentState: row.current_state,
    activeProposalCycle: row.active_proposal_cycle,
    reschedulingActive: row.rescheduling_active,
    reschedulingInitiatedAt:
      typeof row.rescheduling_initiated_at === 'string' ? row.rescheduling_initiated_at : null,
    reschedulingInitiatedByUserId:
      typeof row.rescheduling_initiated_by_user_id === 'string'
        ? row.rescheduling_initiated_by_user_id
        : null,
    confirmedSlotId: typeof row.confirmed_slot_id === 'string' ? row.confirmed_slot_id : null,
    pendingSlotId: typeof row.pending_slot_id === 'string' ? row.pending_slot_id : null,
    slotSelectedByUserId:
      typeof row.slot_selected_by_user_id === 'string' ? row.slot_selected_by_user_id : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseMeetingSlot(row: Record<string, unknown>): MeetingSlot | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.meeting_id !== 'string' ||
    typeof row.institution_id !== 'string' ||
    typeof row.proposal_cycle !== 'number' ||
    typeof row.starts_at !== 'string' ||
    typeof row.ends_at !== 'string' ||
    typeof row.slot_status !== 'string' ||
    typeof row.created_by_user_id !== 'string' ||
    typeof row.created_at !== 'string'
  ) {
    return null
  }

  return {
    id: row.id,
    meetingId: row.meeting_id,
    institutionId: row.institution_id,
    proposalCycle: row.proposal_cycle,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    slotStatus: row.slot_status as MeetingSlot['slotStatus'],
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  }
}

function parseMeetingAuditEvent(row: Record<string, unknown>): MeetingAuditEvent | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.meeting_id !== 'string' ||
    typeof row.institution_id !== 'string' ||
    typeof row.actor_user_id !== 'string' ||
    typeof row.event_type !== 'string' ||
    typeof row.created_at !== 'string'
  ) {
    return null
  }

  const fromState =
    typeof row.from_state === 'string' && isMeetingState(row.from_state) ? row.from_state : null
  const toState =
    typeof row.to_state === 'string' && isMeetingState(row.to_state) ? row.to_state : null

  return {
    id: row.id,
    meetingId: row.meeting_id,
    institutionId: row.institution_id,
    actorUserId: row.actor_user_id,
    eventType: row.event_type as MeetingAuditEvent['eventType'],
    fromState,
    toState,
    proposalCycle: typeof row.proposal_cycle === 'number' ? row.proposal_cycle : null,
    slotId: typeof row.slot_id === 'string' ? row.slot_id : null,
    metadata: typeof row.metadata === 'object' && row.metadata !== null ? (row.metadata as Record<string, unknown>) : {},
    createdAt: row.created_at,
  }
}

function parseCommandResult(data: unknown): MeetingCommandResult {
  if (typeof data !== 'object' || data === null) {
    return { ok: false, errorMessage: 'תגובת שרת לא תקינה.' }
  }

  const payload = data as {
    ok?: unknown
    meeting_id?: unknown
    current_state?: unknown
    rescheduling_active?: unknown
  }

  if (payload.ok === true && typeof payload.current_state === 'string' && isMeetingState(payload.current_state)) {
    return {
      ok: true,
      meetingId: typeof payload.meeting_id === 'string' ? payload.meeting_id : undefined,
      currentState: payload.current_state,
      reschedulingActive:
        typeof payload.rescheduling_active === 'boolean' ? payload.rescheduling_active : undefined,
    }
  }

  return { ok: false, errorMessage: 'לא ניתן להשלים את פעולת לוח הפגישות.' }
}

function mapRpcError(error: { message?: string } | null): string {
  return mapMeetingCalendarError(error?.message)
}

export async function loadMeetings(): Promise<LoadMeetingsResult> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[meetingCalendar] failed to load meetings', error)
    return { ok: false, errorMessage: 'לא ניתן לטעון פגישות.' }
  }

  const meetings = (data ?? [])
    .map((row) => parseMeeting(row as Record<string, unknown>))
    .filter((meeting): meeting is Meeting => meeting !== null)

  return { ok: true, meetings }
}

export async function loadMeetingSlots(meetingId: string): Promise<LoadMeetingSlotsResult> {
  const { data, error } = await supabase
    .from('meeting_slots')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('starts_at', { ascending: true })

  if (error) {
    console.error('[meetingCalendar] failed to load meeting slots', error)
    return { ok: false, errorMessage: 'לא ניתן לטעון זמני פגישה.' }
  }

  const slots = (data ?? [])
    .map((row) => parseMeetingSlot(row as Record<string, unknown>))
    .filter((slot): slot is MeetingSlot => slot !== null)

  return { ok: true, slots }
}

export async function loadMeetingAuditEvents(
  meetingId: string,
): Promise<LoadMeetingAuditEventsResult> {
  const { data, error } = await supabase
    .from('meeting_audit_events')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[meetingCalendar] failed to load meeting audit events', error)
    return { ok: false, errorMessage: 'לא ניתן לטעון יומן פעילות של הפגישה.' }
  }

  const events = (data ?? [])
    .map((row) => parseMeetingAuditEvent(row as Record<string, unknown>))
    .filter((event): event is MeetingAuditEvent => event !== null)

  return { ok: true, events }
}

export async function createMeeting(input: CreateMeetingInput): Promise<MeetingCommandResult> {
  if (input.durationMinutes !== null && !isMeetingDurationMinutes(input.durationMinutes)) {
    return { ok: false, errorMessage: 'משך הפגישה אינו חוקי.' }
  }

  const { data, error } = await supabase.rpc('meeting_calendar_create_meeting', {
    p_recipient_id: input.recipientId,
    p_subject: input.subject.trim(),
    p_reason: input.reason.trim(),
    p_duration_minutes: input.durationMinutes,
    p_institution_timezone: input.institutionTimezone?.trim() || 'UTC',
  })

  if (error) {
    console.error('[meetingCalendar] failed to create meeting', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  return parseCommandResult(data)
}

export async function approveMeetingByOwner(meetingId: string): Promise<MeetingCommandResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_approve_by_owner', {
    p_meeting_id: meetingId,
  })

  if (error) {
    console.error('[meetingCalendar] failed to approve meeting', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  return parseCommandResult(data)
}

export async function setMeetingDuration(
  meetingId: string,
  durationMinutes: MeetingDurationMinutes,
): Promise<MeetingCommandResult> {
  if (!isMeetingDurationMinutes(durationMinutes)) {
    return { ok: false, errorMessage: 'משך הפגישה אינו חוקי.' }
  }

  const { data, error } = await supabase.rpc('meeting_calendar_set_duration', {
    p_meeting_id: meetingId,
    p_duration_minutes: durationMinutes,
  })

  if (error) {
    console.error('[meetingCalendar] failed to set meeting duration', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  return parseCommandResult(data)
}

export async function proposeMeetingSlots(
  meetingId: string,
  slots: ProposedMeetingSlotInput[],
  durationMinutes: MeetingDurationMinutes,
): Promise<MeetingCommandResult> {
  const validationError = validateProposedMeetingSlots({ slots, durationMinutes })
  if (validationError) {
    return { ok: false, errorMessage: validationError }
  }

  const { data, error } = await supabase.rpc('meeting_calendar_propose_slots', {
    p_meeting_id: meetingId,
    p_slots: slots.map((slot) => ({
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
    })),
  })

  if (error) {
    console.error('[meetingCalendar] failed to propose meeting slots', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  return parseCommandResult(data)
}

export async function selectMeetingSlot(
  meetingId: string,
  slotId: string,
): Promise<MeetingCommandResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_select_slot', {
    p_meeting_id: meetingId,
    p_slot_id: slotId,
  })

  if (error) {
    console.error('[meetingCalendar] failed to select meeting slot', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  return parseCommandResult(data)
}

export async function confirmMeeting(meetingId: string): Promise<MeetingCommandResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_confirm_meeting', {
    p_meeting_id: meetingId,
  })

  if (error) {
    console.error('[meetingCalendar] failed to confirm meeting', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  return parseCommandResult(data)
}

export async function cancelMeeting(
  meetingId: string,
  reason?: string,
): Promise<MeetingCommandResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_cancel_meeting', {
    p_meeting_id: meetingId,
    p_reason: reason?.trim() || null,
  })

  if (error) {
    console.error('[meetingCalendar] failed to cancel meeting', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  return parseCommandResult(data)
}

export async function rescheduleMeeting(meetingId: string): Promise<MeetingCommandResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_reschedule_meeting', {
    p_meeting_id: meetingId,
  })

  if (error) {
    console.error('[meetingCalendar] failed to reschedule meeting', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  return parseCommandResult(data)
}

export async function completeMeeting(meetingId: string): Promise<MeetingCommandResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_complete_meeting', {
    p_meeting_id: meetingId,
  })

  if (error) {
    console.error('[meetingCalendar] failed to complete meeting', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  return parseCommandResult(data)
}

export function isTerminalMeetingState(state: MeetingState): boolean {
  return state === 'CANCELLED' || state === 'COMPLETED'
}
