import type { RequestPayload, RequestStatus, RequestType } from './request'

export const NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED = 'REQUEST_STATUS_CHANGED'

export type TeacherRequestNotificationContext = {
  requestId: string
  requestType: RequestType
  description: string
  status: RequestStatus
  archivedAt: string | null
  requestPayload?: RequestPayload
}

export type TeacherNotificationCardDisplay = {
  title: string
  context: string
  event: string
  ariaLabel: string
}
