export type ReminderRequestLocation =
  | { kind: 'secretary_inbox' }
  | { kind: 'secretary_institutional_archive'; page: number }
  | { kind: 'manager_recent' }
  | { kind: 'manager_personal_archive'; page: number }
  | { kind: 'not_found' }

export type ReminderNavigationIntent = {
  token: number
  requestId: string
  notificationId: string
  location: ReminderRequestLocation
}
