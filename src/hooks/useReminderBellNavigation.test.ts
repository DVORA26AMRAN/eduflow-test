import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AppNotification } from '../services/notifications'
import { NOTIFICATION_TYPE_REQUEST_REMINDER } from '../types/requestReminder'
import { useReminderBellNavigation } from './useReminderBellNavigation'

const unreadNotification: AppNotification = {
  id: 'notification-1',
  notification_type: NOTIFICATION_TYPE_REQUEST_REMINDER,
  title: 'תזכורת',
  message: 'תזכורת על בקשה',
  is_read: false,
  metadata: { request_id: 'req-1' },
  created_at: '2026-07-02T12:00:00.000Z',
}

describe('useReminderBellNavigation', () => {
  it('navigates to the newest unread reminder request and marks it as read', async () => {
    const scrollToSection = vi.fn()
    const resolveLocation = vi.fn().mockResolvedValue({ kind: 'secretary_inbox' })
    const markReminderNotificationAsRead = vi.fn().mockResolvedValue(true)
    const onNavigationAnnouncement = vi.fn()

    const { result } = renderHook(() =>
      useReminderBellNavigation({
        role: 'secretary',
        scrollToSection,
        resolveLocation,
        getNewestUnreadReminder: () => unreadNotification,
        markReminderNotificationAsRead,
        onNavigationAnnouncement,
      }),
    )

    await act(async () => {
      await result.current.handleReminderBellClick()
    })

    expect(scrollToSection).toHaveBeenCalledWith('requestsInbox')
    expect(resolveLocation).toHaveBeenCalledWith('req-1')
    expect(markReminderNotificationAsRead).toHaveBeenCalledWith('notification-1')
    expect(result.current.navigationIntent?.requestId).toBe('req-1')
    expect(onNavigationAnnouncement).toHaveBeenCalled()
  })
})
