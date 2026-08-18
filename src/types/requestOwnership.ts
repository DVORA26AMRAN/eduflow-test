import type { EligibleHandlerRole, HandlerHistoryAction } from '../domain/requestOwnership'
import type { GeneralRequestRecipientRole, RequestStatus } from './request'

export type RequestAssignmentFields = {
  handled_by_user_id: string | null
  handled_by_full_name: string | null
  handled_by_primary_role: EligibleHandlerRole | null
  recipient_role: GeneralRequestRecipientRole | null
}

export type RequestHandlerOption = {
  id: string
  fullName: string
  primaryRole: EligibleHandlerRole
  status: 'active' | 'inactive'
}

export type RequestHandlerHistoryEntry = {
  id: string
  action: HandlerHistoryAction
  createdAt: string
  actorUserId: string
  actorFullName: string | null
  previousHandlerUserId: string | null
  previousHandlerFullName: string | null
  newHandlerUserId: string | null
  newHandlerFullName: string | null
}

export type RequestHandlerAssignedPatch = {
  requestId: string
  handledByUserId: string
  handledByFullName: string
  handledByPrimaryRole: EligibleHandlerRole
  status: RequestStatus
}

export type RequestOwnershipErrorCode =
  | 'REQUEST_ALREADY_CLAIMED'
  | 'REQUEST_FINAL_STATE'
  | 'REQUEST_ARCHIVED'
  | 'REQUEST_NOT_ASSIGNED'
  | 'REQUEST_NOT_CLAIMABLE'
  | 'REQUEST_RELEASE_NOT_ALLOWED'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN'

export const EMPTY_REQUEST_ASSIGNMENT: RequestAssignmentFields = {
  handled_by_user_id: null,
  handled_by_full_name: null,
  handled_by_primary_role: null,
  recipient_role: null,
}

export function isRequestOwnershipConflictCode(code: string | undefined): boolean {
  return (
    code === 'REQUEST_ALREADY_CLAIMED' ||
    code === 'REQUEST_FINAL_STATE' ||
    code === 'REQUEST_ARCHIVED' ||
    code === 'REQUEST_NOT_ASSIGNED' ||
    code === 'REQUEST_NOT_CLAIMABLE' ||
    code === 'REQUEST_RELEASE_NOT_ALLOWED'
  )
}

export const REQUEST_OWNERSHIP_MESSAGES: Record<RequestOwnershipErrorCode, string> = {
  REQUEST_ALREADY_CLAIMED: 'הבקשה כבר נלקחה לטיפול על ידי משתמשת אחרת.',
  REQUEST_FINAL_STATE: 'לא ניתן לשנות טיפול בבקשה שהושלמה או נדחתה.',
  REQUEST_ARCHIVED: 'לא ניתן לטפל בבקשה שבארכיון.',
  REQUEST_NOT_ASSIGNED: 'הבקשה אינה משויכת למטפלת.',
  REQUEST_NOT_CLAIMABLE: 'לא ניתן לקחת בקשה זו לטיפול.',
  REQUEST_RELEASE_NOT_ALLOWED: 'ניתן לשחרר טיפול רק מבקשה שבטיפול.',
  PERMISSION_DENIED: 'פעולה זו אינה מותרת.',
  UNKNOWN: 'עדכון הטיפול נכשל.',
}
