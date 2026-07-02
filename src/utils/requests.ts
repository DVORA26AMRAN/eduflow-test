import type {
  RequestStatus,
  RequestType,
  SecretaryInboxFilters,
  SecretaryInboxRequest,
} from '../types/request'

const requestTypeLabels: Record<RequestType, string> = {
  equipment: 'ציוד',
  maintenance: 'תחזוקה',
  pedagogical: 'פדגוגי',
  other: 'אחר',
}

const requestStatusLabels: Record<RequestStatus, string> = {
  new: 'חדש',
  in_progress: 'בטיפול',
  completed: 'הושלם',
  rejected: 'נדחה',
}

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

export function isRequestType(value: string): value is RequestType {
  return (
    value === 'equipment' ||
    value === 'maintenance' ||
    value === 'pedagogical' ||
    value === 'other'
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

export function filterSecretaryInboxRequests(
  requests: SecretaryInboxRequest[],
  filters: SecretaryInboxFilters,
): SecretaryInboxRequest[] {
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
