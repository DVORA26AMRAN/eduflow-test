import type {
  ArchiveFilters,
  ArchivedTeacherRequest,
  RequestStatus,
  RequestType,
  SecretaryArchiveFilters,
  SecretaryArchivedRequest,
  SecretaryInboxFilters,
  SecretaryInboxRequest,
} from '../types/request'
import type {
  ManagerPersonalArchivedRequest,
  ManagerPersonalArchiveFilters,
} from '../types/managerPersonalArchive'

const requestTypeLabels: Record<RequestType, string> = {
  absence: 'היעדרויות',
  budget_or_equipment: 'בקשת תקציב / ציוד',
  substitute_teacher: 'מילוי מקום',
  general_request: 'בקשה אחרת',
}

export type TeacherNewRequestCategoryType = Exclude<RequestType, 'substitute_teacher'>

export type TeacherRequestCategory = {
  value: TeacherNewRequestCategoryType
  title: string
  description: string
}

export const TEACHER_REQUEST_CATEGORIES: TeacherRequestCategory[] = [
  {
    value: 'absence',
    title: 'היעדרויות',
    description: 'דיווח על היעדרות או חופשה',
  },
  {
    value: 'budget_or_equipment',
    title: 'בקשת תקציב / ציוד',
    description: 'בקשת ציוד, תקציב או משאבים',
  },
  {
    value: 'general_request',
    title: 'בקשה אחרת',
    description: 'פנייה חופשית למזכירה או למנהלת',
  },
]

export const REQUEST_TYPE_OPTIONS: { value: RequestType; label: string }[] = [
  { value: 'absence', label: requestTypeLabels.absence },
  { value: 'budget_or_equipment', label: requestTypeLabels.budget_or_equipment },
  { value: 'substitute_teacher', label: requestTypeLabels.substitute_teacher },
  { value: 'general_request', label: requestTypeLabels.general_request },
]

const requestStatusLabels: Record<RequestStatus, string> = {
  new: 'חדש',
  in_progress: 'בטיפול',
  completed: 'הושלם',
  rejected: 'נדחה',
}

export const REQUEST_STATUS_OPTIONS: { value: RequestStatus; label: string }[] = [
  { value: 'new', label: requestStatusLabels.new },
  { value: 'in_progress', label: requestStatusLabels.in_progress },
  { value: 'completed', label: requestStatusLabels.completed },
  { value: 'rejected', label: requestStatusLabels.rejected },
]

export function translateRequestType(type: RequestType): string {
  return requestTypeLabels[type]
}

export function translateRequestStatus(status: RequestStatus): string {
  return requestStatusLabels[status]
}

export function formatRequestDate(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    return isoDate
  }

  return date.toLocaleDateString('he-IL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatRequestDateTime(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    return isoDate
  }

  return date.toLocaleString('he-IL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function isRequestType(value: string): value is RequestType {
  return (
    value === 'absence' ||
    value === 'budget_or_equipment' ||
    value === 'substitute_teacher' ||
    value === 'general_request'
  )
}

export function isRequestStatus(value: string): value is RequestStatus {
  return (
    value === 'new' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'rejected'
  )
}

export function canArchiveInstitutionRequest(status: RequestStatus): boolean {
  return status === 'completed' || status === 'rejected'
}

export function filterSecretaryInboxRequests(
  requests: SecretaryInboxRequest[],
  filters: SecretaryInboxFilters,
  requestIdsWithAttachments: ReadonlySet<string> = new Set(),
): SecretaryInboxRequest[] {
  const nameQuery = filters.teacherNameQuery.trim().toLowerCase()
  const descriptionQuery = filters.descriptionQuery.trim().toLowerCase()

  return requests.filter((request) => {
    if (nameQuery && !request.teacher_full_name.toLowerCase().includes(nameQuery)) {
      return false
    }

    if (descriptionQuery && !request.description.toLowerCase().includes(descriptionQuery)) {
      return false
    }

    if (filters.requestType !== 'all' && request.request_type !== filters.requestType) {
      return false
    }

    if (filters.requestStatus !== 'all' && request.status !== filters.requestStatus) {
      return false
    }

    if (!isDateOnOrAfter(request.created_at, filters.dateFrom)) {
      return false
    }

    if (!isDateOnOrBefore(request.created_at, filters.dateTo)) {
      return false
    }

    if (filters.attachmentsOnly && !requestIdsWithAttachments.has(request.id)) {
      return false
    }

    return true
  })
}

function isDateOnOrAfter(isoDate: string, dateFrom: string): boolean {
  if (!dateFrom) {
    return true
  }

  const value = new Date(isoDate)
  const from = new Date(`${dateFrom}T00:00:00`)
  if (Number.isNaN(value.getTime()) || Number.isNaN(from.getTime())) {
    return true
  }

  return value.getTime() >= from.getTime()
}

function isDateOnOrBefore(isoDate: string, dateTo: string): boolean {
  if (!dateTo) {
    return true
  }

  const value = new Date(isoDate)
  const to = new Date(`${dateTo}T23:59:59.999`)
  if (Number.isNaN(value.getTime()) || Number.isNaN(to.getTime())) {
    return true
  }

  return value.getTime() <= to.getTime()
}

export function filterSecretaryArchivedRequests(
  requests: SecretaryArchivedRequest[],
  filters: SecretaryArchiveFilters,
): SecretaryArchivedRequest[] {
  const nameQuery = filters.teacherNameQuery.trim().toLowerCase()

  return requests.filter((request) => {
    if (nameQuery && !request.teacher_full_name.toLowerCase().includes(nameQuery)) {
      return false
    }

    if (filters.requestType !== 'all' && request.request_type !== filters.requestType) {
      return false
    }

    if (filters.requestStatus !== 'all' && request.status !== filters.requestStatus) {
      return false
    }

    return true
  })
}

export function filterManagerPersonalArchivedRequests(
  requests: ManagerPersonalArchivedRequest[],
  filters: ManagerPersonalArchiveFilters,
): ManagerPersonalArchivedRequest[] {
  return filterSecretaryArchivedRequests(
    requests,
    filters,
  ) as ManagerPersonalArchivedRequest[]
}

export function filterArchivedTeacherRequests(
  requests: ArchivedTeacherRequest[],
  filters: ArchiveFilters,
): ArchivedTeacherRequest[] {
  return requests.filter((request) => {
    if (filters.requestType !== 'all' && request.request_type !== filters.requestType) {
      return false
    }

    if (filters.requestStatus !== 'all' && request.status !== filters.requestStatus) {
      return false
    }

    if (!isDateOnOrAfter(request.archived_at, filters.dateFrom)) {
      return false
    }

    if (!isDateOnOrBefore(request.archived_at, filters.dateTo)) {
      return false
    }

    return true
  })
}
