import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  loadAdminNotifications,
  getUnreadReminderRequestIds,
  markNotificationAsRead,
  subscribeToAdminNotifications,
  unsubscribeFromAdminNotifications,
  type AppNotification,
} from '../../services/notifications'
import { NOTIFICATION_TYPE_REQUEST_REMINDER } from '../../types/requestReminder'
import { supabase } from '../../services/supabase'
import { NavBellIcon } from '../dashboard/dashboardNav'
import { DashboardCollapsibleSection } from '../dashboard/DashboardCollapsibleSection'
import { AdminNotificationsList } from './AdminNotificationsList'

type AdminNotificationsSectionProps = {
  onUnreadCountChange?: (unreadCount: number) => void
  onUnreadReminderRequestIdsChange?: (requestIds: Set<string>) => void
}

function prependNotificationIfNew(
  currentNotifications: AppNotification[],
  notification: AppNotification,
): AppNotification[] {
  if (currentNotifications.some((item) => item.id === notification.id)) {
    return currentNotifications
  }

  return [notification, ...currentNotifications]
}

export function AdminNotificationsSection({
  onUnreadCountChange,
  onUnreadReminderRequestIdsChange,
}: AdminNotificationsSectionProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const reminderNotifications = useMemo(
    () =>
      notifications.filter(
        (notification) => notification.notification_type === NOTIFICATION_TYPE_REQUEST_REMINDER,
      ),
    [notifications],
  )

  const unreadCount = useMemo(
    () => reminderNotifications.filter((notification) => !notification.is_read).length,
    [reminderNotifications],
  )

  const unreadReminderRequestIds = useMemo(
    () => getUnreadReminderRequestIds(reminderNotifications),
    [reminderNotifications],
  )

  useEffect(() => {
    onUnreadCountChange?.(unreadCount)
  }, [onUnreadCountChange, unreadCount])

  useEffect(() => {
    onUnreadReminderRequestIdsChange?.(unreadReminderRequestIds)
  }, [onUnreadReminderRequestIdsChange, unreadReminderRequestIds])

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadAdminNotifications()

    if (!result.ok) {
      setNotifications([])
      setLoadError(result.errorMessage)
    } else {
      setNotifications(result.notifications)
    }

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

      const subscribedChannel = subscribeToAdminNotifications(userId, (notification) => {
        if (notification.notification_type !== NOTIFICATION_TYPE_REQUEST_REMINDER) {
          return
        }

        setNotifications((currentNotifications) =>
          prependNotificationIfNew(currentNotifications, notification),
        )
      })

      if (isCancelled) {
        void unsubscribeFromAdminNotifications(subscribedChannel)
        return
      }

      channel = subscribedChannel
    }

    void setupRealtimeSubscription()

    return () => {
      isCancelled = true

      if (channel) {
        void unsubscribeFromAdminNotifications(channel)
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
    <section className="admin-notifications">
      <DashboardCollapsibleSection
        title="התראות תזכורת"
        icon={<NavBellIcon />}
        headerAddon={
          !isLoading && !loadError ? (
            <p className="admin-notifications__count">
              {unreadCount === 0
                ? 'אין התראות שלא נקראו'
                : `${unreadCount} התראות שלא נקראו`}
            </p>
          ) : null
        }
        className="dashboard-collapsible-section--flush-header"
      >
        <div className="ds-card admin-notifications__card">
          {isLoading && <p className="ds-form-message">טוען התראות...</p>}

          {!isLoading && loadError && (
            <p className="ds-form-message ds-form-message--error">{loadError}</p>
          )}

          {!isLoading && !loadError && (
            <AdminNotificationsList
              notifications={reminderNotifications}
              onNotificationClick={handleNotificationClick}
            />
          )}
        </div>
      </DashboardCollapsibleSection>
    </section>
  )
}
