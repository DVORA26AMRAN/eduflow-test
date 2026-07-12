import type { AppNotification } from '../../services/notifications'
import { formatRequestDateTime } from '../../utils/requests'
import { getReminderCountFromMetadata, getReminderRequestId } from '../../utils/requestReminders'

type AdminNotificationsListProps = {
  notifications: AppNotification[]
  onNotificationClick: (notificationId: string) => void
}

export function AdminNotificationsList({
  notifications,
  onNotificationClick,
}: AdminNotificationsListProps) {
  if (notifications.length === 0) {
    return (
      <div className="ds-state admin-notifications__empty-state">
        <span className="ds-state__icon" aria-hidden="true">
          🔔
        </span>
        <p className="ds-state__title">אין התראות תזכורת.</p>
      </div>
    )
  }

  return (
    <ul className="admin-notifications__list">
      {notifications.map((notification) => {
        const requestId = getReminderRequestId(notification)
        const reminderCount = getReminderCountFromMetadata(notification)

        return (
          <li key={notification.id}>
            <button
              type="button"
              className={
                notification.is_read
                  ? 'admin-notifications__item admin-notifications__item--read'
                  : 'admin-notifications__item admin-notifications__item--unread'
              }
              onClick={() => onNotificationClick(notification.id)}
            >
              <div className="admin-notifications__item-header">
                <h4 className="admin-notifications__item-title">{notification.title}</h4>
                {!notification.is_read && (
                  <span className="admin-notifications__item-badge">חדש</span>
                )}
              </div>
              <p className="admin-notifications__item-message">{notification.message}</p>
              <div className="admin-notifications__item-meta">
                {typeof reminderCount === 'number' && (
                  <span className="admin-notifications__item-count">
                    {reminderCount === 1 ? 'תזכורת אחת' : `${reminderCount} תזכורות`}
                  </span>
                )}
                {requestId && (
                  <span className="admin-notifications__item-request">בקשה #{requestId.slice(0, 8)}</span>
                )}
                <span className="admin-notifications__item-date">
                  {formatRequestDateTime(notification.created_at)}
                </span>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
