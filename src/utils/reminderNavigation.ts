import type { AppNotification } from '../services/notifications'
import { NOTIFICATION_TYPE_REQUEST_REMINDER } from '../types/requestReminder'
import type { SecretaryInboxFilters, SecretaryArchiveFilters } from '../types/request'
import type { ManagerPersonalArchiveFilters } from '../types/managerPersonalArchive'
import { getReminderRequestId } from './requestReminders'

export const REMINDER_BELL_NAV_ID = 'reminderBell'

export const REMINDER_NAV_LABEL = 'תזכורות בקשות'

export const REMINDER_NAV_ARIA_LABEL = 'יש תזכורות חדשות לבקשות'

export const SECRETARY_INBOX_DEFAULT_FILTERS: SecretaryInboxFilters = {
  teacherNameQuery: '',
  descriptionQuery: '',
  requestType: 'all',
  requestStatus: 'all',
  dateFrom: '',
  dateTo: '',
  attachmentsOnly: false,
}

export const SECRETARY_ARCHIVE_DEFAULT_FILTERS: SecretaryArchiveFilters = {
  teacherNameQuery: '',
  requestType: 'all',
  requestStatus: 'all',
  dateFrom: '',
  dateTo: '',
}

export const MANAGER_ARCHIVE_DEFAULT_FILTERS: ManagerPersonalArchiveFilters = {
  teacherNameQuery: '',
  requestType: 'all',
  requestStatus: 'all',
  dateFrom: '',
  dateTo: '',
}

export function getNewestUnreadReminderNotification(
  notifications: readonly AppNotification[],
): AppNotification | null {
  let newest: AppNotification | null = null

  for (const notification of notifications) {
    if (
      notification.notification_type !== NOTIFICATION_TYPE_REQUEST_REMINDER ||
      notification.is_read
    ) {
      continue
    }

    if (!newest || notification.created_at > newest.created_at) {
      newest = notification
    }
  }

  return newest
}

export function getReminderNotifications(
  notifications: readonly AppNotification[],
): AppNotification[] {
  return notifications.filter(
    (notification) => notification.notification_type === NOTIFICATION_TYPE_REQUEST_REMINDER,
  )
}

export function getReminderSectionIdForLocation(
  location: { kind: string },
  role: 'secretary' | 'institution_manager',
): string {
  if (location.kind === 'secretary_inbox') {
    return 'requestsInbox'
  }

  if (location.kind === 'secretary_institutional_archive') {
    return 'institutionalArchive'
  }

  if (location.kind === 'manager_personal_archive') {
    return 'archive'
  }

  if (role === 'institution_manager') {
    return 'recentActivity'
  }

  return 'requestsInbox'
}

export function shouldResetSecretaryInboxFilters(
  _filters: SecretaryInboxFilters,
  requestId: string,
  requests: ReadonlyArray<{ id: string }>,
  filteredRequestIds: ReadonlySet<string>,
): boolean {
  if (!requests.some((request) => request.id === requestId)) {
    return false
  }

  return !filteredRequestIds.has(requestId)
}

export function shouldResetArchiveFilters<T extends SecretaryArchiveFilters>(
  _filters: T,
  requestId: string,
  requests: ReadonlyArray<{ id: string }>,
  filteredRequestIds: ReadonlySet<string>,
): boolean {
  if (!requests.some((request) => request.id === requestId)) {
    return false
  }

  return !filteredRequestIds.has(requestId)
}

export function extractReminderNavigationRequestId(
  notification: AppNotification,
): string | null {
  return getReminderRequestId(notification)
}
