import type { TeacherNotification } from '../../types/notification'
import type { TeacherRequestNotificationContext } from '../../types/teacherNotification'
import { formatRequestDateTime } from '../../utils/requests'
import {
  buildTeacherRequestNotificationDisplay,
  isTeacherRequestNotification,
} from '../../utils/teacherNotificationDisplay'

type TeacherNotificationsListProps = {
  notifications: TeacherNotification[]
  requestContextsById: ReadonlyMap<string, TeacherRequestNotificationContext>
  onNotificationClick: (notificationId: string, buttonElement: HTMLButtonElement) => void
}

export function TeacherNotificationsList({
  notifications,
  requestContextsById,
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
      {notifications.map((notification) => {
        const isRequestNotification = isTeacherRequestNotification(notification)
        const requestId =
          typeof notification.metadata.request_id === 'string'
            ? notification.metadata.request_id
            : null
        const requestContext = requestId ? requestContextsById.get(requestId) : undefined
        const requestDisplay =
          isRequestNotification && requestId
            ? buildTeacherRequestNotificationDisplay(notification, requestContext, requestId)
            : null

        return (
          <li key={notification.id}>
            <button
              type="button"
              className={
                notification.is_read
                  ? 'teacher-dashboard__notification teacher-dashboard__notification--read'
                  : 'teacher-dashboard__notification teacher-dashboard__notification--unread'
              }
              aria-label={requestDisplay?.ariaLabel ?? notification.title}
              onClick={(event) => onNotificationClick(notification.id, event.currentTarget)}
            >
              <div className="teacher-dashboard__notification-header">
                <h4 className="teacher-dashboard__notification-title">
                  {requestDisplay?.title ?? notification.title}
                </h4>
                {!notification.is_read && (
                  <span className="teacher-dashboard__notification-badge">חדש</span>
                )}
              </div>
              {requestDisplay ? (
                <>
                  <p
                    className="teacher-dashboard__notification-context"
                    title={requestDisplay.context}
                  >
                    {requestDisplay.context}
                  </p>
                  <p className="teacher-dashboard__notification-message">{requestDisplay.event}</p>
                </>
              ) : (
                <p className="teacher-dashboard__notification-message">{notification.message}</p>
              )}
              <p className="teacher-dashboard__notification-date">
                {formatRequestDateTime(notification.created_at)}
              </p>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
