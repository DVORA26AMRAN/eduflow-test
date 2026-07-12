import type { RequestStatus, RequestType } from './request'

export type ManagerPersonalArchivedRequest = {
  id: string
  request_type: RequestType
  status: RequestStatus
  created_at: string
  archived_at: string
  teacher_full_name: string
}

export type ManagerPersonalArchiveFilters = {
  teacherNameQuery: string
  requestType: RequestType | 'all'
  requestStatus: RequestStatus | 'all'
  dateFrom: string
  dateTo: string
}
