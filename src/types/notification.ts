export type TeacherNotification = {
  id: string
  notification_type: string
  title: string
  message: string
  is_read: boolean
  metadata: Record<string, unknown>
  created_at: string
}
