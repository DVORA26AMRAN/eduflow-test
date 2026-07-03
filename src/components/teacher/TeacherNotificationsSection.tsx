import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { TeacherNotification } from '../../types/notification'
import {
  loadNotifications,
  markNotificationAsRead,
  subscribeToTeacherNotifications,
  unsubscribeFromTeacherNotifications,
} from '../../services/notifications'
import { supabase } from '../../services/supabase'
import { TeacherNotificationsList } from './TeacherNotificationsList'

function prependNotificationIfNew(
  currentNotifications: TeacherNotification[],
  notification: TeacherNotification,
): TeacherNotification[] {
  if (currentNotifications.some((item) => item.id === notification.id)) {
    return currentNotifications
  }

  return [notification, ...currentNotifications]
}

export function TeacherNotificationsSection() {
  const [notifications, setNotifications] = useState<TeacherNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.is_read).length,
    [notifications],
  )

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadNotifications()

    if (!result.ok) {
      setNotifications([])
      setLoadError(result.errorMessage)
    } else {
      setNotifications(result.notifications)
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    void fetchNotifications()
  }, [fetchNotifications])

  useEffect(() => {
    let channel: RealtimeChannel | null = null
    let isCancelled = false

    async function setupRealtimeSubscription() {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error('[notifications] failed to load session for realtime', error)
        return
      }

      const userId = data.session?.user?.id
      if (!userId || isCancelled) {
        return
      }

      const subscribedChannel = subscribeToTeacherNotifications(userId, (notification) => {
        setNotifications((currentNotifications) =>
          prependNotificationIfNew(currentNotifications, notification),
        )
      })

      if (isCancelled) {
        void unsubscribeFromTeacherNotifications(subscribedChannel)
        return
      }

      channel = subscribedChannel
    }

    void setupRealtimeSubscription()

    return () => {
      isCancelled = true

      if (channel) {
        void unsubscribeFromTeacherNotifications(channel)
      }
    }
  }, [])

  async function handleNotificationClick(notificationId: string) {
    const notification = notifications.find((item) => item.id === notificationId)
    if (!notification || notification.is_read) {
      return
    }

    const result = await markNotificationAsRead(notificationId)

    if (!result.ok) {
      return
    }

    setNotifications((currentNotifications) =>
      currentNotifications.map((item) =>
        item.id === notificationId ? { ...item, is_read: true } : item,
      ),
    )
  }

  return (
    <section className="teacher-dashboard__notifications">
      <div className="teacher-dashboard__notifications-header">
        <h2 className="teacher-dashboard__section-title">התראות</h2>
        {!isLoading && !loadError && (
          <p className="teacher-dashboard__notifications-count">
            {unreadCount === 0
              ? 'אין התראות שלא נקראו'
              : `${unreadCount} התראות שלא נקראו`}
          </p>
        )}
      </div>

      <div className="ds-card teacher-dashboard__notifications-card">
        {isLoading && <p className="ds-form-message">טוען התראות...</p>}

        {!isLoading && loadError && (
          <p className="ds-form-message ds-form-message--error">{loadError}</p>
        )}

        {!isLoading && !loadError && (
          <TeacherNotificationsList
            notifications={notifications}
            onNotificationClick={handleNotificationClick}
          />
        )}
      </div>
    </section>
  )
}
