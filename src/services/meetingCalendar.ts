import type {
  CreateMeetingInput,
  Meeting,
  MeetingAuditEvent,
  MeetingAuditEventType,
  MeetingCommandResult,
  MeetingDurationMinutes,
  MeetingSlot,
  MeetingState,
  ProposedMeetingSlotInput,
} from '../types/meetingCalendar'
import {
  MEETING_AUDIT_EVENT_TYPES,
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

export type ConfirmedMeetingWithSlot = {
  meeting: Meeting
  slot: MeetingSlot
}

export type LoadConfirmedMeetingsWithSlotsResult =
  | { ok: true; items: ConfirmedMeetingWithSlot[] }
  | { ok: false; errorMessage: string }

export const UPCOMING_CONFIRMED_MEETINGS_LIMIT = 50

function parseConfirmedMeetingWithSlot(
  row: Record<string, unknown>,
): ConfirmedMeetingWithSlot | null {
  const meeting = parseMeeting(row)
  if (!meeting) {
    return null
  }

  const slot = parseMeetingSlot({
    id: row.slot_id,
    meeting_id: row.id,
    institution_id: row.institution_id,
    proposal_cycle: row.slot_proposal_cycle,
    starts_at: row.slot_starts_at,
    ends_at: row.slot_ends_at,
    slot_status: row.slot_status,
    created_by_user_id: row.slot_created_by_user_id,
    created_at: row.slot_created_at,
  })

  if (!slot) {
    return null
  }

  return { meeting, slot }
}

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
    activeProposedSlotCount:
      typeof row.active_proposed_slot_count === 'number' ? row.active_proposed_slot_count : null,
    meetingFormat:
      row.meeting_format === 'online' ||
      row.meeting_format === 'phone' ||
      row.meeting_format === 'in_person'
        ? row.meeting_format
        : 'in_person',
    meetUrl: typeof row.meet_url === 'string' ? row.meet_url : null,
    phoneNumber: typeof row.phone_number === 'string' ? row.phone_number : null,
    delayMinutes:
      row.delay_minutes === 5 || row.delay_minutes === 10 || row.delay_minutes === 15
        ? row.delay_minutes
        : null,
    delayReportedByUserId:
      typeof row.delay_reported_by_user_id === 'string' ? row.delay_reported_by_user_id : null,
    delayReportedAt: typeof row.delay_reported_at === 'string' ? row.delay_reported_at : null,
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

function isMeetingAuditEventType(value: string): value is MeetingAuditEventType {
  return (MEETING_AUDIT_EVENT_TYPES as readonly string[]).includes(value)
}

function parseMeetingAuditEvent(row: Record<string, unknown>): MeetingAuditEvent | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.meeting_id !== 'string' ||
    typeof row.institution_id !== 'string' ||
    typeof row.actor_user_id !== 'string' ||
    typeof row.event_type !== 'string' ||
    !isMeetingAuditEventType(row.event_type) ||
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
    eventType: row.event_type,
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

export async function loadPendingMeetings(): Promise<LoadMeetingsResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_list_pending_meetings')

  if (error) {
    console.error('[meetingCalendar] failed to load pending meetings', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  const meetings = (Array.isArray(data) ? data : [])
    .map((row) => parseMeeting(row as Record<string, unknown>))
    .filter((meeting): meeting is Meeting => meeting !== null)

  return { ok: true, meetings }
}

export async function loadConfirmedMeetingsInRange(input: {
  rangeStart: Date
  rangeEnd: Date
}): Promise<LoadConfirmedMeetingsWithSlotsResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_list_confirmed_in_range', {
    p_range_start: input.rangeStart.toISOString(),
    p_range_end: input.rangeEnd.toISOString(),
  })

  if (error) {
    console.error('[meetingCalendar] failed to load confirmed meetings in range', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  const items = (Array.isArray(data) ? data : [])
    .map((row) => parseConfirmedMeetingWithSlot(row as Record<string, unknown>))
    .filter((item): item is ConfirmedMeetingWithSlot => item !== null)

  return { ok: true, items }
}

export async function loadUpcomingConfirmedMeetings(input?: {
  from?: Date
  limit?: number
}): Promise<LoadConfirmedMeetingsWithSlotsResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_list_upcoming_confirmed', {
    p_from: (input?.from ?? new Date()).toISOString(),
    p_limit: input?.limit ?? UPCOMING_CONFIRMED_MEETINGS_LIMIT,
  })

  if (error) {
    console.error('[meetingCalendar] failed to load upcoming confirmed meetings', error)
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  const items = (Array.isArray(data) ? data : [])
    .map((row) => parseConfirmedMeetingWithSlot(row as Record<string, unknown>))
    .filter((item): item is ConfirmedMeetingWithSlot => item !== null)

  return { ok: true, items }
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

export async function loadMeetingSlotsByIds(
  slotIds: string[],
): Promise<LoadMeetingSlotsResult> {
  const uniqueIds = [...new Set(slotIds.filter(Boolean))]
  if (uniqueIds.length === 0) {
    return { ok: true, slots: [] }
  }

  const { data, error } = await supabase
    .from('meeting_slots')
    .select('*')
    .in('id', uniqueIds)
    .order('starts_at', { ascending: true })

  if (error) {
    console.error('[meetingCalendar] failed to load meeting slots by ids', error)
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

  const institutionTimezone = input.institutionTimezone.trim()
  if (!institutionTimezone) {
    return { ok: false, errorMessage: 'אזור הזמן של המוסד אינו מוגדר.' }
  }

  const { data, error } = await supabase.rpc('meeting_calendar_create_meeting', {
    p_recipient_id: input.recipientId,
    p_subject: input.subject.trim(),
    p_reason: input.reason.trim(),
    p_duration_minutes: input.durationMinutes,
    p_institution_timezone: institutionTimezone,
    p_meeting_format: input.meetingFormat,
    p_phone_number: input.meetingFormat === 'phone' ? (input.phoneNumber ?? null) : null,
    p_meet_url: null,
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

export type MeetingLiveContext = {
  meetingId: string
  currentState: MeetingState
  meetingFormat: 'online' | 'phone' | 'in_person'
  meetUrl: string | null
  meetProvisionStatus:
    | 'not_applicable'
    | 'google_not_connected'
    | 'pending'
    | 'ready'
    | 'failed'
    | null
  meetProvisionError: string | null
  phoneNumber: string | null
  startsAt: string | null
  endsAt: string | null
  delayMinutes: 5 | 10 | 15 | null
  delayReportedByUserId: string | null
  delayReportedAt: string | null
  primaryActionAvailable: boolean
  delayActionAvailable: boolean
  canSetConnectionDetails: boolean
  canRequestMeetProvision: boolean
  isCalendarOwner: boolean
  ownerGoogleConnected: boolean
  ownerGoogleConnectionStatus: 'connected' | 'not_connected' | 'reauthorization_required'
}

export type LoadMeetingLiveContextResult =
  | { ok: true; context: MeetingLiveContext }
  | { ok: false; errorMessage: string }

function parseLiveContext(data: unknown): MeetingLiveContext | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const row = data as Record<string, unknown>
  if (row.ok !== true || typeof row.meeting_id !== 'string') {
    return null
  }

  const format =
    row.meeting_format === 'online' ||
    row.meeting_format === 'phone' ||
    row.meeting_format === 'in_person'
      ? row.meeting_format
      : 'in_person'

  const provisionStatus = row.meet_provision_status
  const meetProvisionStatus =
    provisionStatus === 'not_applicable' ||
    provisionStatus === 'google_not_connected' ||
    provisionStatus === 'pending' ||
    provisionStatus === 'ready' ||
    provisionStatus === 'failed'
      ? provisionStatus
      : null

  const connectionStatus = row.owner_google_connection_status
  const ownerGoogleConnectionStatus =
    connectionStatus === 'connected' ||
    connectionStatus === 'not_connected' ||
    connectionStatus === 'reauthorization_required'
      ? connectionStatus
      : row.owner_google_connected === true
        ? 'connected'
        : 'not_connected'

  return {
    meetingId: row.meeting_id,
    currentState:
      typeof row.current_state === 'string' && isMeetingState(row.current_state)
        ? row.current_state
        : 'CONFIRMED',
    meetingFormat: format,
    meetUrl: typeof row.meet_url === 'string' ? row.meet_url : null,
    meetProvisionStatus,
    meetProvisionError:
      typeof row.meet_provision_error === 'string' ? row.meet_provision_error : null,
    phoneNumber: typeof row.phone_number === 'string' ? row.phone_number : null,
    startsAt: typeof row.starts_at === 'string' ? row.starts_at : null,
    endsAt: typeof row.ends_at === 'string' ? row.ends_at : null,
    delayMinutes:
      row.delay_minutes === 5 || row.delay_minutes === 10 || row.delay_minutes === 15
        ? row.delay_minutes
        : null,
    delayReportedByUserId:
      typeof row.delay_reported_by_user_id === 'string' ? row.delay_reported_by_user_id : null,
    delayReportedAt: typeof row.delay_reported_at === 'string' ? row.delay_reported_at : null,
    primaryActionAvailable: row.primary_action_available === true,
    delayActionAvailable: row.delay_action_available === true,
    canSetConnectionDetails: row.can_set_connection_details === true,
    canRequestMeetProvision: row.can_request_meet_provision === true,
    isCalendarOwner: row.is_calendar_owner === true,
    ownerGoogleConnected: row.owner_google_connected === true,
    ownerGoogleConnectionStatus,
  }
}

export async function loadMeetingLiveContext(
  meetingId: string,
): Promise<LoadMeetingLiveContextResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_get_live_context', {
    p_meeting_id: meetingId,
  })

  if (error) {
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  const context = parseLiveContext(data)
  if (!context) {
    return { ok: false, errorMessage: 'תגובת שרת לא תקינה.' }
  }

  return { ok: true, context }
}

export async function setMeetingConnectionDetails(input: {
  meetingId: string
  meetingFormat: 'online' | 'phone' | 'in_person'
  phoneNumber?: string | null
}): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  // Meet URLs are system-managed; never send p_meet_url from the client.
  const { data, error } = await supabase.rpc('meeting_calendar_set_connection_details', {
    p_meeting_id: input.meetingId,
    p_meeting_format: input.meetingFormat,
    p_meet_url: null,
    p_phone_number: input.phoneNumber ?? null,
  })

  if (error) {
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
    return { ok: false, errorMessage: 'שמירת פרטי החיבור נכשלה.' }
  }

  return { ok: true }
}

export async function reportMeetingDelay(input: {
  meetingId: string
  delayMinutes: 5 | 10 | 15
}): Promise<{ ok: true; delayMinutes: 5 | 10 | 15 } | { ok: false; errorMessage: string }> {
  const { data, error } = await supabase.rpc('meeting_calendar_report_delay', {
    p_meeting_id: input.meetingId,
    p_delay_minutes: input.delayMinutes,
  })

  if (error) {
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
    return { ok: false, errorMessage: 'דיווח האיחור נכשל.' }
  }

  return { ok: true, delayMinutes: input.delayMinutes }
}

export type RecordLivePrimaryActionResult =
  | {
      ok: true
      eventType: 'online_meeting_opened' | 'phone_call_started'
      meetUrl: string | null
      phoneNumber: string | null
    }
  | { ok: false; errorMessage: string }

export async function recordLivePrimaryAction(
  meetingId: string,
): Promise<RecordLivePrimaryActionResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_record_live_primary_action', {
    p_meeting_id: meetingId,
  })

  if (error) {
    return { ok: false, errorMessage: mapRpcError(error) }
  }

  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
    return { ok: false, errorMessage: 'רישום פעולת הפגישה נכשל.' }
  }

  const row = data as Record<string, unknown>
  const eventType =
    row.event_type === 'online_meeting_opened' || row.event_type === 'phone_call_started'
      ? row.event_type
      : null
  if (!eventType) {
    return { ok: false, errorMessage: 'תגובת שרת לא תקינה.' }
  }

  return {
    ok: true,
    eventType,
    meetUrl: typeof row.meet_url === 'string' ? row.meet_url : null,
    phoneNumber: typeof row.phone_number === 'string' ? row.phone_number : null,
  }
}

/** CANCELLED is the only implemented terminal state used by live actions. */
export function isTerminalMeetingState(state: MeetingState): boolean {
  return state === 'CANCELLED'
}
