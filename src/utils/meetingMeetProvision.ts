/**
 * Client-side helpers mirroring Phase 1 Meet provision SQL contracts.
 * Deterministic request keys must match meeting_calendar_build_meet_request_key.
 */

export const MEET_PROVISION_STATUSES = [
  'not_applicable',
  'google_not_connected',
  'pending',
  'ready',
  'failed',
] as const

export type MeetProvisionStatus = (typeof MEET_PROVISION_STATUSES)[number]

export const MEET_OUTBOX_STATUSES = [
  'awaiting_connection',
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
] as const

export type MeetOutboxStatus = (typeof MEET_OUTBOX_STATUSES)[number]

export function buildMeetProvisionRequestKey(
  meetingId: string,
  confirmedSlotId: string,
): string {
  return `adoflow-${meetingId}-${confirmedSlotId}`
}

export function isGoogleApiEligibleOutboxStatus(status: MeetOutboxStatus): boolean {
  return status === 'pending' || status === 'processing'
}

/**
 * Closing the browser must not be required for provisioning: only durable
 * outbox statuses that workers claim may call Google.
 */
export function shouldEnqueueGoogleApiAttempt(args: {
  meetingFormat: 'online' | 'phone' | 'in_person'
  ownerGoogleConnected: boolean
}): { meetingStatus: MeetProvisionStatus; outboxStatus: MeetOutboxStatus; enqueued: boolean } {
  if (args.meetingFormat !== 'online') {
    return {
      meetingStatus: 'not_applicable',
      outboxStatus: 'cancelled',
      enqueued: false,
    }
  }

  if (!args.ownerGoogleConnected) {
    return {
      meetingStatus: 'google_not_connected',
      outboxStatus: 'awaiting_connection',
      enqueued: false,
    }
  }

  return {
    meetingStatus: 'pending',
    outboxStatus: 'pending',
    enqueued: true,
  }
}
