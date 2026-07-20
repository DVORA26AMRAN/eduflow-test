import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { AppNotification } from '../../services/notifications'
import {
  loadNotifications,
  markNotificationAsRead,
  subscribeToUserNotifications,
  unsubscribeFromUserNotifications,
} from '../../services/notifications'
import { supabase } from '../../services/supabase'
import {
  extractMeetingIdFromNotificationMetadata,
  isMeetingNotificationType,
} from '../../utils/meetingCalendarLifecycle'

type MeetingNotificationsPanelProps = {
  actorUserId: string
  onOpenMeeting?: (meetingId: string) => void
}

export function MeetingNotificationsPanel({
  actorUserId,
  onOpenMeeting,
}: MeetingNotificationsPanelProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const meetingNotifications = useMemo(
    () =>
      notifications.filter((notification) =>
        isMeetingNotificationType(notification.notification_type),
      ),
    [notifications],
  )

  const unreadCount = useMemo(
    () => meetingNotifications.filter((notification) => !notification.is_read).length,
    [meetingNotifications],
  )

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')
    const result = await loadNotifications()
    if (!result.ok) {
      setErrorMessage(result.errorMessage)
      setNotifications([])
      setIsLoading(false)
      return
    }
    setNotifications(result.notifications)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchNotifications()
    })
  }, [fetchNotifications])

  useEffect(() => {
    let channel: RealtimeChannel | null = null
    let isCancelled = false

    void (async () => {
      const { data } = await supabase.auth.getSession()
      if (isCancelled) {
        return
      }
      const userId = data.session?.user.id ?? actorUserId
      channel = subscribeToUserNotifications(
        userId,
        (notification) => {
          setNotifications((current) => {
            if (current.some((item) => item.id === notification.id)) {
              return current
            }
            return [notification, ...current]
          })
        },
        'meeting-calendar-panel',
      )
    })()

    return () => {
      isCancelled = true
      if (channel) {
        unsubscribeFromUserNotifications(channel)
      }
    }
  }, [actorUserId])

  async function handleOpen(notification: AppNotification) {
    if (!notification.is_read) {
      await markNotificationAsRead(notification.id)
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, is_read: true } : item,
        ),
      )
    }

    const meetingId = extractMeetingIdFromNotificationMetadata(notification.metadata)
    if (meetingId && onOpenMeeting) {
      onOpenMeeting(meetingId)
    }
  }

  return (
    <section className="mc-notifications" aria-label="התראות יומן פגישות">
      <div className="mc-notifications__header">
        <h3>התראות פגישות</h3>
        {unreadCount > 0 ? (
          <span className="mc-notifications__count" aria-label={`${unreadCount} התראות שלא נקראו`}>
            {unreadCount}
          </span>
        ) : null}
      </div>

      {isLoading ? <p role="status">טוען התראות…</p> : null}
      {errorMessage ? (
        <p className="ds-form-message ds-form-message--error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {!isLoading && !errorMessage && meetingNotifications.length === 0 ? (
        <p className="ds-empty-state">אין התראות פגישות.</p>
      ) : null}

      {!isLoading && meetingNotifications.length > 0 ? (
        <ul className="mc-notifications__list">
          {meetingNotifications.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                className={`mc-notifications__item ${notification.is_read ? '' : 'mc-notifications__item--unread'}`}
                onClick={() => void handleOpen(notification)}
              >
                <strong>{notification.title}</strong>
                <span>{notification.message}</span>
                <span>{new Date(notification.created_at).toLocaleString('he-IL')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
