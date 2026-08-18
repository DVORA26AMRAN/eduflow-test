import type { RequestPayload, RequestStatus, RequestType } from './request'
import type { RequestAssignmentFields } from './requestOwnership'

export type ManagerAnalytics = {
  activeTeachersCount: number
  activeSecretariesCount: number
  totalRequestsCount: number
  newRequestsCount: number
  inProgressRequestsCount: number
  completedRequestsCount: number
  rejectedRequestsCount: number
  requestTypeCounts: {
    absence: number
    budget_or_equipment: number
    substitute_teacher: number
    general_request: number
  }
}

export type ManagerRecentRequest = {
  id: string
  teacher_full_name: string
  request_type: RequestType
  description: string
  status: RequestStatus
  created_at: string
  request_payload?: RequestPayload
} & RequestAssignmentFields

export type ManagerRecentActivityEntry = {
  id: string
  previous_status: RequestStatus
  new_status: RequestStatus
  created_at: string
}
