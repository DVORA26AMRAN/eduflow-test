import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { DashboardRequestNavigationIntent } from '../../types/dashboardAnalytics'
import type { TeacherNotification } from '../../types/notification'
import type { TeacherRequestNotificationContext } from '../../types/teacherNotification'
import {
  loadNotifications,
  markNotificationAsRead,
  subscribeToTeacherNotifications,
  unsubscribeFromTeacherNotifications,
} from '../../services/notifications'
import { loadTeacherRequestNotificationContexts } from '../../services/teacherNotificationRequests'
import { supabase } from '../../services/supabase'
import {
  collectTeacherRequestNotificationIds,
  extractRequestIdFromNotification,
  isTeacherRequestNotification,
} from '../../utils/teacherNotificationDisplay'
import { NavBellIcon } from '../dashboard/dashboardNav'
import { DashboardSection } from '../dashboard/DashboardSection'
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

function mergeRequestContexts(
  currentContexts: ReadonlyMap<string, TeacherRequestNotificationContext>,
  incomingContexts: ReadonlyMap<string, TeacherRequestNotificationContext>,
): Map<string, TeacherRequestNotificationContext> {
  const mergedContexts = new Map(currentContexts)

  for (const [requestId, context] of incomingContexts) {
    mergedContexts.set(requestId, context)
  }

  return mergedContexts
}

type TeacherNotificationsSectionProps = {
  onNavigateToRequest?: (
    intent: DashboardRequestNavigationIntent,
    options: {
      archived: boolean
      returnFocusElement: HTMLButtonElement | null
    },
  ) => void
}

export function TeacherNotificationsSection({
  onNavigateToRequest,
}: TeacherNotificationsSectionProps) {
  const [notifications, setNotifications] = useState<TeacherNotification[]>([])
  const [requestContextsById, setRequestContextsById] = useState<
    Map<string, TeacherRequestNotificationContext>
  >(new Map())
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
      setIsLoading(false)
      return
    }

    setNotifications(result.notifications)

    const requestIds = collectTeacherRequestNotificationIds(result.notifications)
    if (requestIds.length > 0) {
      const contextsResult = await loadTeacherRequestNotificationContexts(requestIds)
      if (contextsResult.ok) {
        setRequestContextsById(contextsResult.contexts)
      }
    } else {
      setRequestContextsById(new Map())
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

      const subscribedChannel = subscribeToTeacherNotifications(userId, (notification) => {
        setNotifications((currentNotifications) =>
          prependNotificationIfNew(currentNotifications, notification),
        )

        if (!isTeacherRequestNotification(notification)) {
          return
        }

        const requestId = extractRequestIdFromNotification(notification)
        if (!requestId) {
          return
        }

        void loadTeacherRequestNotificationContexts([requestId]).then((result) => {
          if (!result.ok) {
            return
          }

          setRequestContextsById((currentContexts) =>
            mergeRequestContexts(currentContexts, result.contexts),
          )
        })
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

  async function handleNotificationClick(
    notificationId: string,
    buttonElement: HTMLButtonElement,
  ) {
    const notification = notifications.find((item) => item.id === notificationId)
    if (!notification) {
      return
    }

    if (!notification.is_read) {
      const result = await markNotificationAsRead(notificationId)

      if (result.ok) {
        setNotifications((currentNotifications) =>
          currentNotifications.map((item) =>
            item.id === notificationId ? { ...item, is_read: true } : item,
          ),
        )
      }
    }

    if (!isTeacherRequestNotification(notification) || !onNavigateToRequest) {
      return
    }

    const requestId = extractRequestIdFromNotification(notification)
    if (!requestId) {
      return
    }

    const context = requestContextsById.get(requestId)

    onNavigateToRequest(
      {
        requestId,
        requestType: context?.requestType,
        requestStatus: context?.status,
      },
      {
        archived: Boolean(context?.archivedAt),
        returnFocusElement: buttonElement,
      },
    )
  }

  return (
    <section className="teacher-dashboard__notifications">
      <DashboardSection
        title="התראות"
        icon={<NavBellIcon />}
        headerAddon={
          !isLoading && !loadError ? (
            <p className="teacher-dashboard__notifications-count">
              {unreadCount === 0
                ? 'אין התראות שלא נקראו'
                : `${unreadCount} התראות שלא נקראו`}
            </p>
          ) : null
        }
        className="dashboard-section--flush-header"
      >
        <div className="ds-card teacher-dashboard__notifications-card">
          {isLoading && <p className="ds-form-message">טוען התראות...</p>}

          {!isLoading && loadError && (
            <p className="ds-form-message ds-form-message--error">{loadError}</p>
          )}

          {!isLoading && !loadError && (
            <TeacherNotificationsList
              notifications={notifications}
              requestContextsById={requestContextsById}
              onNotificationClick={handleNotificationClick}
            />
          )}
        </div>
      </DashboardSection>
    </section>
  )
}
