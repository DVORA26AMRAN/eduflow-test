import type { RequestStatus, RequestType } from './request'

export const DASHBOARD_OVERVIEW_SECTION_ID = 'overview'

export type DashboardDateRangePreset = '7d' | '30d' | '90d' | 'school_year'

export type DashboardDateRange = {
  preset: DashboardDateRangePreset
  startAt: string
  endAt: string
}

export type StatusCountMap = Record<RequestStatus, number>

export type RequestTypeCountMap = Record<RequestType, number>

export type TimeSeriesPoint = {
  bucketStart: string
  label: string
  count: number
}

export type CompletionRatePoint = {
  bucketStart: string
  label: string
  completionRate: number | null
  resolvedCount: number
}

export type ProcessingTimePoint = {
  bucketStart: string
  label: string
  averageHours: number | null
  resolvedCount: number
}

export type WorkloadAgingBucketId = 'under_24h' | '1_3_days' | '4_7_days' | 'over_7_days'

export type WorkloadAgingBucket = {
  id: WorkloadAgingBucketId
  label: string
  count: number
}

export type GeneralRequestRoutingCounts = {
  secretary: number
  institution_manager: number
}

export type DashboardAttentionItem = {
  id: string
  requestType: RequestType
  description: string
  status: RequestStatus
  createdAt: string
  teacherFullName?: string
  reminderCount?: number
  hasUnreadReminder?: boolean
}

export type TeacherDashboardAnalytics = {
  totalSubmitted: number
  statusCounts: StatusCountMap
  typeCounts: RequestTypeCountMap
  trend: TimeSeriesPoint[]
  followUpRequests: DashboardAttentionItem[]
  longestAwaitingHours: number | null
}

export type SecretaryDashboardAnalytics = {
  activeRequests: number
  statusCounts: StatusCountMap
  activeWorkloadCounts: Pick<StatusCountMap, 'new' | 'in_progress'>
  completedInPeriod: number
  rejectedInPeriod: number
  unreadReminderCount: number
  typeCounts: RequestTypeCountMap
  trend: TimeSeriesPoint[]
  processingTimeTrend: ProcessingTimePoint[]
  averageProcessingHours: number | null
  attentionRequests: DashboardAttentionItem[]
  workloadAging: WorkloadAgingBucket[]
}

export type ManagerDashboardAnalytics = {
  totalInstitutionRequests: number
  activeRequests: number
  statusCounts: StatusCountMap
  completionRate: number | null
  requestsWithReminders: number
  typeCounts: RequestTypeCountMap
  trend: TimeSeriesPoint[]
  completionTrend: CompletionRatePoint[]
  averageProcessingHours: number | null
  processingTimeTrend: ProcessingTimePoint[]
  generalRequestRouting: GeneralRequestRoutingCounts
  attentionRequests: DashboardAttentionItem[]
  typeBacklog: { requestType: RequestType; activeCount: number }[]
}

export type DashboardRequestNavigationIntent = {
  requestStatus?: RequestStatus | 'all'
  requestType?: RequestType | 'all'
  requestId?: string
}
