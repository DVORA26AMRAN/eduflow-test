export const REQUEST_REMINDER_COOLDOWN_HOURS = 24

export const NOTIFICATION_TYPE_REQUEST_REMINDER = 'REQUEST_REMINDER'

export type RequestReminderSummary = {
  request_id: string
  reminder_count: number
  latest_reminder_at: string
}

export type TeacherRequestReminderState = {
  request_id: string
  reminder_count: number
  last_reminder_at: string | null
  next_reminder_available_at: string | null
}

export type AdminNotification = {
  id: string
  notification_type: string
  title: string
  message: string
  is_read: boolean
  metadata: Record<string, unknown>
  created_at: string
}
