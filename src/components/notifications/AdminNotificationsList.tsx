import type { AppNotification } from '../../services/notifications'
import { formatRequestDateTime } from '../../utils/requests'
import { getReminderCountFromMetadata, getReminderRequestId } from '../../utils/requestReminders'
import {
  extractPrintingRequestIdFromNotification,
  isStaffPrintingNotificationType,
} from '../../utils/printingNotifications'
import { formatPrintingRequestNumber } from '../../utils/printingUi'

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
        <p className="ds-state__title">אין התראות.</p>
      </div>
    )
  }

  return (
    <ul className="admin-notifications__list">
      {notifications.map((notification) => {
        const isPrinting = isStaffPrintingNotificationType(notification.notification_type)
        const reminderRequestId = isPrinting ? null : getReminderRequestId(notification)
        const reminderCount = isPrinting ? null : getReminderCountFromMetadata(notification)
        const printingRequestId = isPrinting
          ? extractPrintingRequestIdFromNotification(notification.metadata)
          : null
        const requestNumber = notification.metadata.request_number
        const printingLabel =
          typeof requestNumber === 'number'
            ? formatPrintingRequestNumber(requestNumber)
            : printingRequestId
              ? `בקשת הדפסה ${printingRequestId.slice(0, 8)}`
              : null

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
                {reminderRequestId && (
                  <span className="admin-notifications__item-request">
                    בקשה #{reminderRequestId.slice(0, 8)}
                  </span>
                )}
                {printingLabel && (
                  <span className="admin-notifications__item-request">{printingLabel}</span>
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
