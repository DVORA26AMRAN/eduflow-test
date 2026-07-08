import type { TeacherNotification } from '../../types/notification'
import { formatRequestDateTime } from '../../utils/requests'

type TeacherNotificationsListProps = {
  notifications: TeacherNotification[]
  onNotificationClick: (notificationId: string) => void
}

export function TeacherNotificationsList({
  notifications,
  onNotificationClick,
}: TeacherNotificationsListProps) {
  if (notifications.length === 0) {
    return (
      <div className="ds-state teacher-dashboard__empty-state">
        <span className="ds-state__icon" aria-hidden="true">
          🔔
        </span>
        <p className="ds-state__title">אין לך התראות.</p>
      </div>
    )
  }

  return (
    <ul className="teacher-dashboard__notifications-list">
      {notifications.map((notification) => (
        <li key={notification.id}>
          <button
            type="button"
            className={
              notification.is_read
                ? 'teacher-dashboard__notification teacher-dashboard__notification--read'
                : 'teacher-dashboard__notification teacher-dashboard__notification--unread'
            }
            onClick={() => onNotificationClick(notification.id)}
          >
            <div className="teacher-dashboard__notification-header">
              <h4 className="teacher-dashboard__notification-title">{notification.title}</h4>
              {!notification.is_read && (
                <span className="teacher-dashboard__notification-badge">חדש</span>
              )}
            </div>
            <p className="teacher-dashboard__notification-message">{notification.message}</p>
            <p className="teacher-dashboard__notification-date">
              {formatRequestDateTime(notification.created_at)}
            </p>
          </button>
        </li>
      ))}
    </ul>
  )
}
