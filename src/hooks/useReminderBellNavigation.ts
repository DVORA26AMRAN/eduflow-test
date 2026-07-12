import { useCallback, useRef, useState } from 'react'
import type { AppNotification } from '../services/notifications'
import type { ReminderNavigationIntent, ReminderRequestLocation } from '../types/reminderNavigation'
import {
  extractReminderNavigationRequestId,
  getReminderSectionIdForLocation,
} from '../utils/reminderNavigation'
import { buildReminderNavigationAnnouncement } from '../utils/requestRowNavigation'

type UseReminderBellNavigationOptions = {
  role: 'secretary' | 'institution_manager'
  scrollToSection: (sectionId: string) => void
  resolveLocation: (requestId: string) => Promise<ReminderRequestLocation>
  getNewestUnreadReminder: () => AppNotification | null
  markReminderNotificationAsRead: (notificationId: string) => Promise<boolean>
  onNavigationAnnouncement: (message: string) => void
}

export function useReminderBellNavigation({
  role,
  scrollToSection,
  resolveLocation,
  getNewestUnreadReminder,
  markReminderNotificationAsRead,
  onNavigationAnnouncement,
}: UseReminderBellNavigationOptions) {
  const [navigationIntent, setNavigationIntent] = useState<ReminderNavigationIntent | null>(null)
  const [highlightedRequestId, setHighlightedRequestId] = useState<string | null>(null)
  const navigationTokenRef = useRef(0)

  const handleReminderBellClick = useCallback(async () => {
    const notification = getNewestUnreadReminder()
    if (!notification) {
      return
    }

    const requestId = extractReminderNavigationRequestId(notification)
    if (!requestId) {
      return
    }

    const location = await resolveLocation(requestId)
    if (location.kind === 'not_found') {
      onNavigationAnnouncement('לא ניתן להציג את הבקשה המבוקשת.')
      return
    }

    const sectionId = getReminderSectionIdForLocation(location, role)
    scrollToSection(sectionId)

    navigationTokenRef.current += 1
    const intent: ReminderNavigationIntent = {
      token: navigationTokenRef.current,
      requestId,
      notificationId: notification.id,
      location,
    }

    setHighlightedRequestId(requestId)
    setNavigationIntent(intent)

    await markReminderNotificationAsRead(notification.id)
    onNavigationAnnouncement(buildReminderNavigationAnnouncement())
  }, [
    getNewestUnreadReminder,
    resolveLocation,
    role,
    scrollToSection,
    markReminderNotificationAsRead,
    onNavigationAnnouncement,
  ])

  const handleReminderNavigationComplete = useCallback(
    (token: number, found: boolean) => {
      if (navigationIntent?.token !== token) {
        return
      }

      if (!found) {
        onNavigationAnnouncement('לא ניתן להציג את הבקשה המבוקשת.')
      }

      setNavigationIntent(null)
    },
    [navigationIntent, onNavigationAnnouncement],
  )

  return {
    navigationIntent,
    highlightedRequestId,
    handleReminderBellClick,
    handleReminderNavigationComplete,
  }
}
