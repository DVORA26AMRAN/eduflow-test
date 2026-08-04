import type { PrintItemStatus, PrintingRequestStatus } from '../../types/printing'

const ITEM_TRANSITIONS: Record<PrintItemStatus, readonly PrintItemStatus[]> = {
  pending: ['processing', 'returned_for_correction', 'printed', 'rejected'],
  processing: ['returned_for_correction', 'printed', 'rejected', 'pending'],
  returned_for_correction: ['resubmitted', 'rejected'],
  resubmitted: ['processing', 'returned_for_correction', 'printed', 'rejected'],
  printed: [],
  rejected: [],
}

export function isPrintItemTransitionAllowed(
  from: PrintItemStatus,
  to: PrintItemStatus,
): boolean {
  if (from === to) return true
  return ITEM_TRANSITIONS[from]?.includes(to) ?? false
}

export type ParentStatusInput = {
  parentStatus: PrintingRequestStatus
  assignedSecretaryUserId: string | null
  items: Array<{ status: PrintItemStatus }>
}

/**
 * Mirrors `printing_derive_parent_status` — authoritative parent derivation for tests/clients.
 * Backend remains the source of truth for persisted status.
 */
export function derivePrintingParentStatus(
  input: ParentStatusInput,
): PrintingRequestStatus {
  if (input.parentStatus === 'cancelled') return 'cancelled'

  const items = input.items
  if (items.length === 0) return input.parentStatus

  const printed = items.filter((i) => i.status === 'printed').length
  const rejected = items.filter((i) => i.status === 'rejected').length
  const correction = items.filter((i) =>
    ['returned_for_correction', 'resubmitted'].includes(i.status),
  ).length
  const actionable = items.filter((i) =>
    ['pending', 'processing', 'resubmitted'].includes(i.status),
  ).length

  if (correction > 0) return 'needs_correction'
  if (printed + rejected === items.length && printed > 0) return 'printed'
  if (rejected === items.length) return 'rejected'
  if (actionable > 0 || input.assignedSecretaryUserId != null) return 'in_progress'
  return 'submitted'
}

export type ClaimAttempt = {
  requestId: string
  actorUserId: string
}

export type ClaimState = {
  assignedSecretaryUserId: string | null
  status: PrintingRequestStatus
}

/**
 * Models the atomic claim predicate used by `printing_claim_request`.
 * Concurrent losers observe an already-assigned row after FOR UPDATE.
 */
export function attemptSecretaryClaim(
  state: ClaimState,
  actorUserId: string,
):
  | { ok: true; state: ClaimState; idempotent?: boolean }
  | { ok: false; error_code: 'PRINT_REQUEST_ALREADY_CLAIMED' | 'INVALID_STATUS_TRANSITION' } {
  if (['cancelled', 'printed', 'rejected'].includes(state.status)) {
    return { ok: false, error_code: 'INVALID_STATUS_TRANSITION' }
  }
  if (state.assignedSecretaryUserId != null) {
    if (state.assignedSecretaryUserId === actorUserId) {
      return { ok: true, state, idempotent: true }
    }
    return { ok: false, error_code: 'PRINT_REQUEST_ALREADY_CLAIMED' }
  }
  return {
    ok: true,
    state: {
      assignedSecretaryUserId: actorUserId,
      status: state.status === 'submitted' ? 'in_progress' : state.status,
    },
  }
}

/**
 * Simulates two concurrent claim attempts against shared mutable state.
 * Exactly one success when both start unassigned (second sees first's assignment).
 */
export function simulateConcurrentClaims(
  initial: ClaimState,
  firstActor: string,
  secondActor: string,
): { first: ReturnType<typeof attemptSecretaryClaim>; second: ReturnType<typeof attemptSecretaryClaim> } {
  let shared = { ...initial }
  const first = attemptSecretaryClaim(shared, firstActor)
  if (first.ok) shared = first.state
  const second = attemptSecretaryClaim(shared, secondActor)
  return { first, second }
}

export function canTeacherEditOrCancel(params: {
  teacherUserId: string
  actorUserId: string
  assignedSecretaryUserId: string | null
  processingStartedAt: string | null
  status: PrintingRequestStatus
}): boolean {
  if (params.teacherUserId !== params.actorUserId) return false
  if (params.assignedSecretaryUserId != null) return false
  if (params.processingStartedAt != null) return false
  return params.status === 'submitted' || params.status === 'needs_correction'
}

export function canTransferToSecretary(params: {
  targetRole: string
  targetStatus: string
  targetInstitutionId: string
  requestInstitutionId: string
}):
  | { ok: true }
  | { ok: false; error_code: 'SECRETARY_NOT_AUTHORIZED' | 'CROSS_INSTITUTION_ACCESS_DENIED' } {
  if (params.targetStatus !== 'active' || params.targetRole !== 'secretary') {
    return { ok: false, error_code: 'SECRETARY_NOT_AUTHORIZED' }
  }
  if (params.targetInstitutionId !== params.requestInstitutionId) {
    return { ok: false, error_code: 'CROSS_INSTITUTION_ACCESS_DENIED' }
  }
  return { ok: true }
}

export type PrintingAccessRole = 'teacher' | 'secretary' | 'institution_manager' | 'other'

export function canReadPrintingRequest(params: {
  actorRole: PrintingAccessRole
  actorUserId: string
  actorInstitutionId: string
  teacherUserId: string
  requestInstitutionId: string
}): boolean {
  if (params.actorInstitutionId !== params.requestInstitutionId) return false
  if (params.actorRole === 'teacher') {
    return params.actorUserId === params.teacherUserId
  }
  return params.actorRole === 'secretary' || params.actorRole === 'institution_manager'
}

export function canAccessPrintingFile(params: {
  actorRole: PrintingAccessRole
  actorUserId: string
  actorInstitutionId: string
  teacherUserId: string
  requestInstitutionId: string
}): boolean {
  return canReadPrintingRequest(params)
}
