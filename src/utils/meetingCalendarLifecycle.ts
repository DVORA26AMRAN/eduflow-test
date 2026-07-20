import type { MeetingAuditEvent, MeetingAuditEventType } from '../types/meetingCalendar'
import type { MeetingUserDirectoryEntry } from './meetingCalendarDisplay'

export const MEETING_CANCEL_REASON_MAX_LENGTH = 500

export const MEETING_NOTIFICATION_TYPES = [
  'MEETING_REQUEST_RECEIVED',
  'MEETING_REQUEST_APPROVED',
  'MEETING_SLOTS_PROPOSED',
  'MEETING_SLOT_SELECTED',
  'MEETING_CONFIRMED',
  'MEETING_CANCELLED',
  'MEETING_RESCHEDULE_REQUESTED',
  'MEETING_RESCHEDULE_CONFIRMED',
] as const

export type MeetingNotificationType = (typeof MEETING_NOTIFICATION_TYPES)[number]

const AUDIT_EVENT_LABELS: Record<MeetingAuditEventType, string> = {
  meeting_created: 'נוצרה',
  state_changed: 'אושרה / עודכן מצב',
  slot_proposed: 'הוצעו מועדים',
  slot_selected: 'נבחר מועד',
  meeting_confirmed: 'אושרה',
  meeting_rescheduled: 'התחיל תיאום מחדש',
  meeting_cancelled: 'בוטלה',
}

export function translateMeetingAuditEventType(eventType: MeetingAuditEventType): string {
  return AUDIT_EVENT_LABELS[eventType]
}

export function describeMeetingAuditEvent(
  event: MeetingAuditEvent,
  directory: Map<string, MeetingUserDirectoryEntry>,
): string {
  const actor = directory.get(event.actorUserId)?.fullName ?? 'משתתף'
  const base = translateMeetingAuditEventType(event.eventType)

  if (event.eventType === 'state_changed' && event.fromState && event.toState) {
    if (
      event.fromState === 'WAITING_FOR_OWNER_APPROVAL' &&
      event.toState === 'WAITING_FOR_SLOT_PROPOSAL'
    ) {
      return `${base} · אישור בקשה על ידי ${actor}`
    }
    return `${base} · ${event.fromState} → ${event.toState} · ${actor}`
  }

  if (event.eventType === 'meeting_cancelled') {
    const reason =
      typeof event.metadata.reason === 'string' && event.metadata.reason.trim()
        ? ` · סיבה: ${event.metadata.reason.trim()}`
        : ''
    return `${base} על ידי ${actor}${reason}`
  }

  return `${base} על ידי ${actor}`
}

export function sortMeetingAuditEventsNewestFirst(
  events: MeetingAuditEvent[],
): MeetingAuditEvent[] {
  return [...events].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

export function isMeetingNotificationType(value: string): value is MeetingNotificationType {
  return (MEETING_NOTIFICATION_TYPES as readonly string[]).includes(value)
}

export function extractMeetingIdFromNotificationMetadata(
  metadata: Record<string, unknown>,
): string | null {
  return typeof metadata.meeting_id === 'string' ? metadata.meeting_id : null
}
