import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  getUnreadReminderRequestIds,
  loadAdminNotifications,
  markNotificationAsRead,
  subscribeToAdminNotifications,
  unsubscribeFromAdminNotifications,
  type AppNotification,
} from '../services/notifications'
import { NOTIFICATION_TYPE_REQUEST_REMINDER } from '../types/requestReminder'
import { supabase } from '../services/supabase'
import { getNewestUnreadReminderNotification, getReminderNotifications } from '../utils/reminderNavigation'

function prependNotificationIfNew(
  currentNotifications: AppNotification[],
  notification: AppNotification,
): AppNotification[] {
  if (currentNotifications.some((item) => item.id === notification.id)) {
    return currentNotifications
  }

  return [notification, ...currentNotifications]
}

export function useAdminReminderNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const reminderNotifications = useMemo(
    () => getReminderNotifications(notifications),
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
      try {
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
        }, 'admin-reminder-hook')

        if (isCancelled) {
          await unsubscribeFromAdminNotifications(subscribedChannel)
          return
        }

        channel = subscribedChannel
      } catch (error) {
        if (!isCancelled) {
          console.error('[notifications] admin reminder realtime setup failed', error)
        }
      }
    }

    void setupRealtimeSubscription()

    return () => {
      isCancelled = true

      if (channel) {
        void unsubscribeFromAdminNotifications(channel)
      }
    }
  }, [])

  const markReminderNotificationAsRead = useCallback(async (notificationId: string) => {
    const notification = notifications.find((item) => item.id === notificationId)
    if (!notification || notification.is_read) {
      return false
    }

    const result = await markNotificationAsRead(notificationId)

    if (!result.ok) {
      return false
    }

    setNotifications((currentNotifications) =>
      currentNotifications.map((item) =>
        item.id === notificationId ? { ...item, is_read: true } : item,
      ),
    )

    return true
  }, [notifications])

  const getNewestUnreadReminder = useCallback(() => {
    return getNewestUnreadReminderNotification(reminderNotifications)
  }, [reminderNotifications])

  return {
    notifications,
    reminderNotifications,
    unreadCount,
    unreadReminderRequestIds,
    isLoading,
    loadError,
    fetchNotifications,
    markReminderNotificationAsRead,
    getNewestUnreadReminder,
  }
}
