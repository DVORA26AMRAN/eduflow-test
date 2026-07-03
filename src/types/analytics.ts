import type { RequestStatus, RequestType } from './request'

export type ManagerAnalytics = {
  activeTeachersCount: number
  activeSecretariesCount: number
  totalRequestsCount: number
  newRequestsCount: number
  inProgressRequestsCount: number
  completedRequestsCount: number
  rejectedRequestsCount: number
}

export type ManagerRecentRequest = {
  id: string
  teacher_full_name: string
  request_type: RequestType
  status: RequestStatus
  created_at: string
}

export type ManagerRecentActivityEntry = {
  id: string
  previous_status: RequestStatus
  new_status: RequestStatus
  created_at: string
}
