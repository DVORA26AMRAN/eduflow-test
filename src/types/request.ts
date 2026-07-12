export type RequestType = 'absence' | 'budget_or_equipment' | 'substitute_teacher' | 'general_request'

export type GeneralRequestRecipientRole = 'secretary' | 'institution_manager'

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

export type GeneralRequestPayload = {
  message: string
}

export type GeneralRequestFormFields = {
  recipientRole: GeneralRequestRecipientRole | ''
  subject: string
  message: string
}

export type RequestPayload =
  | AbsenceRequestPayload
  | BudgetOrEquipmentRequestPayload
  | GeneralRequestPayload
  | Record<string, never>

export type RequestStatus = 'new' | 'in_progress' | 'completed' | 'rejected'

export type TeacherRequest = {
  id: string
  request_type: RequestType
  description: string
  status: RequestStatus
  created_at: string
  recipient_role?: GeneralRequestRecipientRole | null
  request_payload?: RequestPayload
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
  recipientRole?: GeneralRequestRecipientRole
}

export type SecretaryInboxRequest = {
  id: string
  request_type: RequestType
  description: string
  status: RequestStatus
  created_at: string
  teacher_full_name: string
  request_payload?: RequestPayload
}

export type SecretaryInboxFilters = {
  teacherNameQuery: string
  descriptionQuery: string
  requestType: RequestType | 'all'
  requestStatus: RequestStatus | 'all'
  dateFrom: string
  dateTo: string
  attachmentsOnly: boolean
}

export type SecretaryArchivedRequest = {
  id: string
  request_type: RequestType
  status: RequestStatus
  created_at: string
  archived_at: string
  teacher_full_name: string
}

export type SecretaryArchiveFilters = {
  teacherNameQuery: string
  requestType: RequestType | 'all'
  requestStatus: RequestStatus | 'all'
  dateFrom: string
  dateTo: string
}

export type RequestStatusHistoryEntry = {
  id: string
  previous_status: RequestStatus
  new_status: RequestStatus
  created_at: string
  changed_by_full_name: string | null
}
