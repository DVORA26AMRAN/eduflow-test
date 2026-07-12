import type { TeacherNotification } from '../types/notification'
import { NOTIFICATION_TYPE_REQUEST_MESSAGE } from '../types/requestMessage'
import type {
  TeacherNotificationCardDisplay,
  TeacherRequestNotificationContext,
} from '../types/teacherNotification'
import { NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED } from '../types/teacherNotification'
import { translateRequestType } from './requests'

export const TEACHER_NOTIFICATION_CONTEXT_MAX_LENGTH = 120

const REQUEST_STATUS_NOTIFICATION_TITLE: Record<
  TeacherRequestNotificationContext['requestType'],
  string
> = {
  absence: 'עדכון לבקשת היעדרות',
  budget_or_equipment: 'עדכון לבקשת תקציב / ציוד',
  substitute_teacher: 'עדכון לבקשת מילוי מקום',
  general_request: 'עדכון לבקשה אחרת',
}

const REQUEST_MESSAGE_NOTIFICATION_TITLE: Record<
  TeacherRequestNotificationContext['requestType'],
  string
> = {
  absence: 'הודעה חדשה בבקשת היעדרות',
  budget_or_equipment: 'הודעה חדשה בבקשת תקציב / ציוד',
  substitute_teacher: 'הודעה חדשה בבקשת מילוי מקום',
  general_request: 'הודעה חדשה בבקשה אחרת',
}

export function isTeacherRequestNotification(notification: TeacherNotification): boolean {
  return (
    notification.notification_type === NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED ||
    notification.notification_type === NOTIFICATION_TYPE_REQUEST_MESSAGE
  )
}

export function extractRequestIdFromNotification(notification: TeacherNotification): string | null {
  const requestId = notification.metadata.request_id
  return typeof requestId === 'string' ? requestId : null
}

export function collectTeacherRequestNotificationIds(notifications: TeacherNotification[]): string[] {
  const requestIds = new Set<string>()

  for (const notification of notifications) {
    if (!isTeacherRequestNotification(notification)) {
      continue
    }

    const requestId = extractRequestIdFromNotification(notification)
    if (requestId) {
      requestIds.add(requestId)
    }
  }

  return [...requestIds]
}

export function truncateNotificationText(
  text: string,
  maxLength = TEACHER_NOTIFICATION_CONTEXT_MAX_LENGTH,
): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, maxLength - 1)}…`
}

export function shortenRequestId(requestId: string): string {
  const compactId = requestId.replace(/-/g, '').slice(0, 8)
  return `בקשה ${compactId}`
}

export function resolveTeacherRequestNotificationContextText(
  context: TeacherRequestNotificationContext | undefined,
  requestId: string,
): string {
  if (context) {
    const subjectOrDescription = context.description.trim()
    if (subjectOrDescription) {
      return truncateNotificationText(subjectOrDescription)
    }

    return truncateNotificationText(translateRequestType(context.requestType))
  }

  return truncateNotificationText(shortenRequestId(requestId))
}

function getRequestNotificationTitle(
  notificationType: string,
  requestType: TeacherRequestNotificationContext['requestType'],
): string {
  if (notificationType === NOTIFICATION_TYPE_REQUEST_MESSAGE) {
    return REQUEST_MESSAGE_NOTIFICATION_TITLE[requestType]
  }

  return REQUEST_STATUS_NOTIFICATION_TITLE[requestType]
}

export function buildTeacherRequestNotificationDisplay(
  notification: TeacherNotification,
  context: TeacherRequestNotificationContext | undefined,
  requestId: string,
): TeacherNotificationCardDisplay {
  const requestType = context?.requestType ?? 'absence'
  const title = context
    ? getRequestNotificationTitle(notification.notification_type, requestType)
    : notification.title
  const contextText = resolveTeacherRequestNotificationContextText(context, requestId)
  const event = notification.message.trim()

  return {
    title,
    context: contextText,
    event,
    ariaLabel: `${title}. ${contextText}. ${event}`,
  }
}
