import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { loadRequestMessageRequestIds } from '../services/requestMessages'
import {
  getUnreadMessageRequestIds,
  loadNotifications,
  markMessageNotificationsAsReadForRequest,
  subscribeToUserNotifications,
  unsubscribeFromUserNotifications,
  type AppNotification,
} from '../services/notifications'
import { NOTIFICATION_TYPE_REQUEST_MESSAGE } from '../types/requestMessage'
import { supabase } from '../services/supabase'

function prependNotificationIfNew(
  currentNotifications: AppNotification[],
  notification: AppNotification,
): AppNotification[] {
  if (currentNotifications.some((item) => item.id === notification.id)) {
    return currentNotifications
  }

  return [notification, ...currentNotifications]
}

function addRequestIdToSet(
  currentRequestIds: ReadonlySet<string>,
  requestId: string,
): ReadonlySet<string> {
  if (currentRequestIds.has(requestId)) {
    return currentRequestIds
  }

  const nextRequestIds = new Set(currentRequestIds)
  nextRequestIds.add(requestId)
  return nextRequestIds
}

export function useUnreadRequestMessageNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [requestIdsWithMessages, setRequestIdsWithMessages] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const messageNotifications = useMemo(
    () =>
      notifications.filter(
        (notification) => notification.notification_type === NOTIFICATION_TYPE_REQUEST_MESSAGE,
      ),
    [notifications],
  )

  const unreadMessageRequestIds = useMemo(
    () => getUnreadMessageRequestIds(messageNotifications),
    [messageNotifications],
  )

  const fetchMessageRequestIds = useCallback(async () => {
    const result = await loadRequestMessageRequestIds()

    if (result.ok) {
      setRequestIdsWithMessages(result.requestIds)
    }
  }, [])

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const [notificationsResult] = await Promise.all([
      loadNotifications(),
      fetchMessageRequestIds(),
    ])

    if (!notificationsResult.ok) {
      setNotifications([])
      setLoadError(notificationsResult.errorMessage)
    } else {
      setNotifications(notificationsResult.notifications)
    }

    setIsLoading(false)
  }, [fetchMessageRequestIds])

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
        console.error('[requestMessages] failed to load session for realtime', error)
        return
      }

      const userId = data.session?.user?.id
      if (!userId || isCancelled) {
        return
      }

      const subscribedChannel = subscribeToUserNotifications(userId, (notification) => {
        if (notification.notification_type !== NOTIFICATION_TYPE_REQUEST_MESSAGE) {
          return
        }

        setNotifications((currentNotifications) =>
          prependNotificationIfNew(currentNotifications, notification),
        )

        const requestId = notification.metadata.request_id
        if (typeof requestId === 'string') {
          setRequestIdsWithMessages((currentRequestIds) =>
            addRequestIdToSet(currentRequestIds, requestId),
          )
        }
      })

      if (isCancelled) {
        void unsubscribeFromUserNotifications(subscribedChannel)
        return
      }

      channel = subscribedChannel
    }

    void setupRealtimeSubscription()

    return () => {
      isCancelled = true

      if (channel) {
        void unsubscribeFromUserNotifications(channel)
      }
    }
  }, [])

  const registerRequestHasMessages = useCallback((requestId: string) => {
    setRequestIdsWithMessages((currentRequestIds) => addRequestIdToSet(currentRequestIds, requestId))
  }, [])

  const markConversationAsRead = useCallback(
    async (requestId: string) => {
      const updated = await markMessageNotificationsAsReadForRequest(requestId, notifications)

      if (updated.length === 0) {
        return false
      }

      const updatedIds = new Set(updated)
      setNotifications((currentNotifications) =>
        currentNotifications.map((item) =>
          updatedIds.has(item.id) ? { ...item, is_read: true } : item,
        ),
      )

      return true
    },
    [notifications],
  )

  return {
    notifications,
    messageNotifications,
    unreadMessageRequestIds,
    requestIdsWithMessages,
    isLoading,
    loadError,
    fetchNotifications,
    markConversationAsRead,
    registerRequestHasMessages,
  }
}
