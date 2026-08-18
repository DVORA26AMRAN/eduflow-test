import type { PrimaryRole } from '../types/user'
import type { GeneralRequestRecipientRole, RequestStatus, RequestType } from '../types/request'

export const ELIGIBLE_HANDLER_ROLES = [
  'institution_manager',
  'deputy',
  'secretary',
] as const

export type EligibleHandlerRole = (typeof ELIGIBLE_HANDLER_ROLES)[number]

export const HANDLER_HISTORY_ACTIONS = ['claim', 'transfer', 'release'] as const

export type HandlerHistoryAction = (typeof HANDLER_HISTORY_ACTIONS)[number]

export function isEligibleHandlerRole(
  role: PrimaryRole | null | undefined,
): role is EligibleHandlerRole {
  return role === 'institution_manager' || role === 'deputy' || role === 'secretary'
}

/** Mirrors request_user_can_handle_request routing, without DB lookups. */
export function canRoleHandleRequest(input: {
  actorRole: PrimaryRole | null | undefined
  actorActive: boolean
  sameInstitution: boolean
  requestType: RequestType
  recipientRole?: GeneralRequestRecipientRole | null
}): boolean {
  if (!input.actorActive || !input.sameInstitution) {
    return false
  }

  if (!isEligibleHandlerRole(input.actorRole)) {
    return false
  }

  if (input.requestType === 'general_request') {
    if (input.recipientRole === 'institution_manager') {
      return input.actorRole === 'institution_manager' || input.actorRole === 'deputy'
    }

    if (input.recipientRole === 'secretary') {
      return input.actorRole === 'secretary'
    }

    return false
  }

  return true
}

export function canClaimRequest(input: {
  archivedAt: string | null
  status: RequestStatus
  handledByUserId: string | null
  actorUserId: string
}): { ok: true; unchanged?: boolean } | { ok: false; error: string } {
  if (input.archivedAt) {
    return { ok: false, error: 'REQUEST_ARCHIVED' }
  }

  if (input.status === 'completed' || input.status === 'rejected') {
    return { ok: false, error: 'REQUEST_FINAL_STATE' }
  }

  if (input.handledByUserId) {
    if (input.handledByUserId === input.actorUserId && input.status === 'in_progress') {
      return { ok: true, unchanged: true }
    }

    return { ok: false, error: 'REQUEST_ALREADY_CLAIMED' }
  }

  if (input.status !== 'new') {
    return { ok: false, error: 'REQUEST_NOT_CLAIMABLE' }
  }

  return { ok: true }
}

export function claimResult(actorUserId: string): {
  handledByUserId: string
  status: RequestStatus
} {
  return { handledByUserId: actorUserId, status: 'in_progress' }
}

export function canAdministrativelyOverrideHandler(
  actorRole: PrimaryRole | null | undefined,
): boolean {
  return actorRole === 'institution_manager'
}

export function canTransferOrReleaseAsActor(input: {
  actorRole: PrimaryRole | null | undefined
  actorUserId: string
  handledByUserId: string | null
}): boolean {
  if (input.handledByUserId === input.actorUserId) {
    return true
  }

  return canAdministrativelyOverrideHandler(input.actorRole)
}

export function canOrdinaryStatusUpdate(input: {
  actorUserId: string
  handledByUserId: string | null
  currentStatus: RequestStatus
  nextStatus: RequestStatus
}): boolean {
  if (input.currentStatus === 'new' && input.nextStatus === 'in_progress') {
    return false
  }

  if (input.handledByUserId === null && input.currentStatus === 'new') {
    return false
  }

  if (input.handledByUserId !== null && input.handledByUserId !== input.actorUserId) {
    return false
  }

  return true
}

export function releaseResult(): {
  handledByUserId: null
  status: RequestStatus
} {
  return { handledByUserId: null, status: 'new' }
}

export function canShowClaimAction(input: {
  actorRole: PrimaryRole | null | undefined
  handledByUserId: string | null
  status: RequestStatus
  requestType: RequestType
  recipientRole?: GeneralRequestRecipientRole | null
}): boolean {
  if (input.handledByUserId) {
    return false
  }

  if (input.status !== 'new') {
    return false
  }

  return canRoleHandleRequest({
    actorRole: input.actorRole,
    actorActive: true,
    sameInstitution: true,
    requestType: input.requestType,
    recipientRole: input.recipientRole,
  })
}

export function canShowHandlerStatusSelect(input: {
  actorUserId: string
  handledByUserId: string | null
}): boolean {
  return input.handledByUserId !== null && input.handledByUserId === input.actorUserId
}

export function canManageCurrentAssignment(input: {
  actorRole: PrimaryRole | null | undefined
  actorUserId: string
  handledByUserId: string | null
}): boolean {
  if (!input.handledByUserId) {
    return false
  }

  return canTransferOrReleaseAsActor(input)
}

export type EligibleHandlerCandidate = {
  id: string
  fullName: string
  primaryRole: EligibleHandlerRole
  status: string
}

export function filterEligibleHandlersForRequest(input: {
  users: EligibleHandlerCandidate[]
  requestType: RequestType
  recipientRole?: GeneralRequestRecipientRole | null
  excludeUserId?: string | null
}): EligibleHandlerCandidate[] {
  return input.users.filter((user) => {
    if (user.status !== 'active') {
      return false
    }

    if (input.excludeUserId && user.id === input.excludeUserId) {
      return false
    }

    return canRoleHandleRequest({
      actorRole: user.primaryRole,
      actorActive: true,
      sameInstitution: true,
      requestType: input.requestType,
      recipientRole: input.recipientRole,
    })
  })
}

export function canReleaseRequest(input: {
  archivedAt: string | null
  status: RequestStatus
  handledByUserId: string | null
}): { ok: true } | { ok: false; error: string } {
  if (input.archivedAt) {
    return { ok: false, error: 'REQUEST_ARCHIVED' }
  }

  if (input.status === 'completed' || input.status === 'rejected') {
    return { ok: false, error: 'REQUEST_FINAL_STATE' }
  }

  if (!input.handledByUserId) {
    return { ok: false, error: 'REQUEST_NOT_ASSIGNED' }
  }

  if (input.status !== 'in_progress') {
    return { ok: false, error: 'REQUEST_RELEASE_NOT_ALLOWED' }
  }

  return { ok: true }
}

export function canShowReleaseAction(input: {
  actorRole: PrimaryRole | null | undefined
  actorUserId: string
  handledByUserId: string | null
  status: RequestStatus
}): boolean {
  if (!canManageCurrentAssignment(input)) {
    return false
  }

  return canReleaseRequest({
    archivedAt: null,
    status: input.status,
    handledByUserId: input.handledByUserId,
  }).ok
}

export function formatHandlerHistoryMessage(entry: {
  action: HandlerHistoryAction
  actorFullName: string | null
  previousHandlerFullName: string | null
  newHandlerFullName: string | null
}): string {
  const actor = entry.actorFullName?.trim() || 'משתמשת'

  if (entry.action === 'claim') {
    return `נלקחה לטיפול על ידי ${entry.newHandlerFullName?.trim() || actor}`
  }

  if (entry.action === 'transfer') {
    const from = entry.previousHandlerFullName?.trim() || 'מטפלת'
    const to = entry.newHandlerFullName?.trim() || 'מטפלת'
    return `הטיפול הועבר מ-${from} ל-${to}`
  }

  return `הטיפול שוחרר על ידי ${actor}`
}
