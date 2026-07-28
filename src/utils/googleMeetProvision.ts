/**
 * Pure helpers mirroring Edge Meet provisioner rules (testable in Vitest).
 */

export async function deriveConferenceRequestIdFromOutboxKey(
  outboxRequestKey: string,
): Promise<string> {
  const data = new TextEncoder().encode(outboxRequestKey)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

export function extractParticipantMeetJoinUrl(event: Record<string, unknown>): string | null {
  if (typeof event.hangoutLink === 'string' && event.hangoutLink.includes('meet.google.com')) {
    return event.hangoutLink
  }
  const conferenceData = event.conferenceData as Record<string, unknown> | undefined
  const entryPoints = conferenceData?.entryPoints
  if (Array.isArray(entryPoints)) {
    for (const ep of entryPoints) {
      const row = ep as Record<string, unknown>
      if (
        row.entryPointType === 'video' &&
        typeof row.uri === 'string' &&
        row.uri.includes('meet.google.com')
      ) {
        return row.uri
      }
    }
  }
  return null
}

export function isClaimableOutboxStatus(status: string): boolean {
  return status === 'pending'
}

export function shouldShortCircuitExistingMeetUrl(meetUrl: string | null | undefined): boolean {
  return typeof meetUrl === 'string' && meetUrl.trim().length > 0
}

export function mapGoogleTokenErrorToProvisionAction(
  googleError: string,
): 'reauthorization_required' | 'retry' | 'fail' {
  if (googleError === 'invalid_grant' || googleError === 'unauthorized_client') {
    return 'reauthorization_required'
  }
  if (googleError === 'timeout' || googleError === 'unavailable' || googleError === 'internal') {
    return 'retry'
  }
  return 'fail'
}

export function buildCalendarEventBody(args: {
  subject: string
  startsAtIso: string
  endsAtIso: string
  timeZone: string
  requestKey: string
  conferenceRequestId: string
}) {
  return {
    summary: args.subject,
    description: 'Adoflow online meeting',
    start: { dateTime: args.startsAtIso, timeZone: args.timeZone || 'UTC' },
    end: { dateTime: args.endsAtIso, timeZone: args.timeZone || 'UTC' },
    attendees: [],
    conferenceData: {
      createRequest: {
        requestId: args.conferenceRequestId,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    extendedProperties: {
      private: {
        adoflow_request_key: args.requestKey,
      },
    },
  }
}
