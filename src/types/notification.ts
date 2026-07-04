export type TeacherNotification = {
  id: string
  notification_type: string
  title: string
  message: string
  is_read: boolean
  metadata: Record<string, unknown>
  created_at: string
}

export const NOTIFICATION_TYPE_SUBSTITUTE_BOARD_APPROVED = 'SUBSTITUTE_BOARD_APPROVED'

export type SubstituteBoardApprovedNotificationRole = 'requester' | 'substitute'
