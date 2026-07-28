/**
 * Integration boundary for automatic Google Meet provisioning (Phase 3).
 *
 * Durable path:
 * 1. Confirm writes meeting_meet_provision_requests (pending or awaiting_connection)
 * 2. Edge Function `meeting-meet-provisioner` claims pending rows only
 * 3. Creates/reuses Google Calendar event with conferenceData; attaches join URL
 *    via service_role meeting_calendar_complete_meet_provision
 *
 * Clients must never create Meet URLs or call the provisioner with user JWT alone
 * as the primary trigger after confirm (outbox is authoritative).
 */

import { supabase } from './supabase'
import { buildMeetProvisionRequestKey } from '../utils/meetingMeetProvision'
import type { MeetProvisionStatus } from '../utils/meetingMeetProvision'

export const MEETING_GOOGLE_MEET_ATTACH_RPC = 'meeting_calendar_attach_system_meet_url'
export const MEETING_MEET_PROVISION_REQUEST_RPC = 'meeting_calendar_request_meet_provision'
export const MEETING_MEET_PROVISION_STATUS_RPC = 'meeting_calendar_get_meet_provision_status'
export const MEETING_GOOGLE_CONNECTION_STATUS_RPC =
  'meeting_calendar_get_google_connection_status'
export const MEETING_MEET_PROVISION_CLAIM_RPC = 'meeting_calendar_claim_meet_provision_batch'
export const MEETING_MEET_PROVISIONER_FN = 'meeting-meet-provisioner'

export { buildMeetProvisionRequestKey }

export type MeetingGoogleMeetProvisionRequest = {
  meetingId: string
  institutionId: string
  subject: string
  startsAtIso: string
  endsAtIso: string
}

export type MeetingGoogleMeetProvisionResult =
  | { ok: true; meetUrl: string }
  | { ok: false; errorMessage: string }

/**
 * Browser clients must not run Google Calendar Meet creation.
 * Use owner requestMeetProvision + backend worker.
 */
export async function provisionGoogleMeetForConfirmedMeeting(
  request: MeetingGoogleMeetProvisionRequest,
): Promise<MeetingGoogleMeetProvisionResult> {
  void request
  return {
    ok: false,
    errorMessage:
      'Google Meet provisioning is worker-owned via meeting_meet_provision_requests outbox.',
  }
}

export type GoogleConnectionStatusResult =
  | { ok: true; connected: boolean; email: string | null; connectionStatus?: string }
  | { ok: false; errorMessage: string }

export type MeetProvisionStatusResult =
  | {
      ok: true
      meetingId: string
      meetProvisionStatus: MeetProvisionStatus
      meetProvisionError: string | null
      meetUrl: string | null
      outboxStatus: string | null
      canRequestMeet: boolean
      ownerGoogleConnected: boolean
      code?: 'GOOGLE_NOT_CONNECTED' | null
    }
  | { ok: false; errorMessage: string }

export type RequestMeetProvisionResult =
  | {
      ok: true
      meetProvisionStatus: MeetProvisionStatus
      enqueued: boolean
      googleConnected: boolean
      requestKey: string | null
      code: 'GOOGLE_NOT_CONNECTED' | null
      idempotent?: boolean
      meetUrl?: string | null
    }
  | { ok: false; errorMessage: string }

export async function getGoogleConnectionStatus(): Promise<GoogleConnectionStatusResult> {
  const { data, error } = await supabase.rpc(MEETING_GOOGLE_CONNECTION_STATUS_RPC)

  if (error) {
    return { ok: false, errorMessage: error.message }
  }

  const row = (data ?? {}) as Record<string, unknown>
  return {
    ok: true,
    connected: row.connected === true,
    email: typeof row.email === 'string' ? row.email : null,
    connectionStatus:
      typeof row.connection_status === 'string' ? row.connection_status : undefined,
  }
}

export async function getMeetProvisionStatus(
  meetingId: string,
): Promise<MeetProvisionStatusResult> {
  const { data, error } = await supabase.rpc(MEETING_MEET_PROVISION_STATUS_RPC, {
    p_meeting_id: meetingId,
  })

  if (error) {
    return { ok: false, errorMessage: error.message }
  }

  const row = (data ?? {}) as Record<string, unknown>
  const status = row.meet_provision_status
  const meetProvisionStatus =
    status === 'not_applicable' ||
    status === 'google_not_connected' ||
    status === 'pending' ||
    status === 'ready' ||
    status === 'failed'
      ? status
      : 'not_applicable'

  return {
    ok: true,
    meetingId: typeof row.meeting_id === 'string' ? row.meeting_id : meetingId,
    meetProvisionStatus,
    meetProvisionError:
      typeof row.meet_provision_error === 'string' ? row.meet_provision_error : null,
    meetUrl: typeof row.meet_url === 'string' ? row.meet_url : null,
    outboxStatus: typeof row.outbox_status === 'string' ? row.outbox_status : null,
    canRequestMeet: row.can_request_meet === true,
    ownerGoogleConnected: row.owner_google_connected === true,
  }
}

export async function requestMeetProvision(
  meetingId: string,
): Promise<RequestMeetProvisionResult> {
  const { data, error } = await supabase.rpc(MEETING_MEET_PROVISION_REQUEST_RPC, {
    p_meeting_id: meetingId,
  })

  if (error) {
    return { ok: false, errorMessage: error.message }
  }

  const row = (data ?? {}) as Record<string, unknown>
  const status = row.meet_provision_status
  const meetProvisionStatus =
    status === 'not_applicable' ||
    status === 'google_not_connected' ||
    status === 'pending' ||
    status === 'ready' ||
    status === 'failed'
      ? status
      : 'not_applicable'

  return {
    ok: true,
    meetProvisionStatus,
    enqueued: row.enqueued === true,
    googleConnected: row.google_connected === true,
    requestKey: typeof row.request_key === 'string' ? row.request_key : null,
    code: row.code === 'GOOGLE_NOT_CONNECTED' ? 'GOOGLE_NOT_CONNECTED' : null,
    idempotent: row.idempotent === true,
    meetUrl: typeof row.meet_url === 'string' ? row.meet_url : null,
  }
}
