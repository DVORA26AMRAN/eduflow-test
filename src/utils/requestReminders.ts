import type { AppNotification } from '../services/notifications'
import type { RequestReminderSummary } from '../types/requestReminder'
import { formatRequestDateTime } from './requests'

export function formatReminderCount(reminderCount: number): string {
  if (reminderCount === 1) {
    return 'תזכורת אחת'
  }

  return `${reminderCount} תזכורות`
}

export function getReminderRowBadgeLabel(reminderCount: number): string {
  if (reminderCount <= 1) {
    return 'התקבלה תזכורת'
  }

  return `התקבלה תזכורת · ${reminderCount}`
}

export function getReminderSummaryLabel(summary: RequestReminderSummary): string {
  return `${formatReminderCount(summary.reminder_count)} · ${formatRequestDateTime(summary.latest_reminder_at)}`
}

export function getReminderRequestId(notification: AppNotification): string | null {
  const requestId = notification.metadata.request_id
  return typeof requestId === 'string' ? requestId : null
}

export function getReminderCountFromMetadata(notification: AppNotification): number | null {
  const reminderCount = notification.metadata.reminder_count
  return typeof reminderCount === 'number' ? reminderCount : null
}
