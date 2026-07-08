export type RequestType = 'absence' | 'budget_or_equipment' | 'substitute_teacher'

export type AbsenceReason =
  | 'sick_leave'
  | 'child_sickness'
  | 'pregnancy_hours'
  | 'other'

export type AbsenceRequestPayload = {
  absence_date: string
  absence_reason: AbsenceReason
  absence_reason_other: string | null
  replaced_by: string | null
}

export type BudgetOrEquipmentRequestPayload = {
  budget_details: string
  requested_amount: number | null
  bank_account_details: string | null
}

export type RequestPayload =
  | AbsenceRequestPayload
  | BudgetOrEquipmentRequestPayload
  | Record<string, never>

export type RequestStatus = 'new' | 'in_progress' | 'completed' | 'rejected'

export type TeacherRequest = {
  id: string
  request_type: RequestType
  description: string
  status: RequestStatus
  created_at: string
}

export type ArchivedTeacherRequest = TeacherRequest & {
  archived_at: string
}

export type ArchiveFilters = {
  requestType: RequestType | 'all'
  requestStatus: RequestStatus | 'all'
  dateFrom: string
  dateTo: string
}

export type CreateRequestInput = {
  requestType: RequestType
  description: string
  requestPayload?: RequestPayload
}

export type SecretaryInboxRequest = {
  id: string
  request_type: RequestType
  description: string
  status: RequestStatus
  created_at: string
  teacher_full_name: string
}

export type SecretaryInboxFilters = {
  teacherNameQuery: string
  requestType: RequestType | 'all'
  requestStatus: RequestStatus | 'all'
}

export type RequestStatusHistoryEntry = {
  id: string
  previous_status: RequestStatus
  new_status: RequestStatus
  created_at: string
  changed_by_full_name: string | null
}
