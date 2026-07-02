export type RequestType = 'equipment' | 'maintenance' | 'pedagogical' | 'other'

export type RequestStatus = 'new' | 'in_progress' | 'completed' | 'rejected'

export type TeacherRequest = {
  id: string
  request_type: RequestType
  description: string
  status: RequestStatus
  created_at: string
}

export type CreateRequestInput = {
  requestType: RequestType
  description: string
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
