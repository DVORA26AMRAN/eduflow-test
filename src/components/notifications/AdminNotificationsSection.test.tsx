import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminNotificationsSection } from './AdminNotificationsSection'
import { NOTIFICATION_TYPE_REQUEST_REMINDER } from '../../types/requestReminder'
import { PRINT_NOTIFICATION_REQUEST_OVERDUE } from '../../utils/printingNotifications'

const loadAdminNotifications = vi.fn()
const markNotificationAsRead = vi.fn()

vi.mock('../../services/notifications', () => ({
  loadAdminNotifications: (...args: unknown[]) => loadAdminNotifications(...args),
  getUnreadReminderRequestIds: () => new Set<string>(),
  markNotificationAsRead: (...args: unknown[]) => markNotificationAsRead(...args),
  subscribeToAdminNotifications: () => ({}),
  unsubscribeFromAdminNotifications: vi.fn(),
}))

vi.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminNotificationsSection printing deep links', () => {
  it('lists overdue printing notifications and navigates to the printing request', async () => {
    const user = userEvent.setup({ delay: null })
    const onNavigateToPrinting = vi.fn()
    markNotificationAsRead.mockResolvedValue({ ok: true })
    loadAdminNotifications.mockResolvedValue({
      ok: true,
      notifications: [
        {
          id: 'n-overdue',
          notification_type: PRINT_NOTIFICATION_REQUEST_OVERDUE,
          title: 'בקשת הדפסה באיחור',
          message: 'בקשת ההדפסה #1042 עברה את מועד היעד ועדיין לא הושלמה.',
          is_read: false,
          metadata: {
            printing_request_id: 'print-req-1',
            request_number: 1042,
            dedupe_key: 'overdue:print-req-1:20260801',
          },
          created_at: '2026-08-04T12:00:00.000Z',
        },
        {
          id: 'n-reminder',
          notification_type: NOTIFICATION_TYPE_REQUEST_REMINDER,
          title: 'תזכורת',
          message: 'תזכורת על בקשה',
          is_read: true,
          metadata: { request_id: 'teacher-req-1' },
          created_at: '2026-08-03T12:00:00.000Z',
        },
      ],
    })

    render(<AdminNotificationsSection onNavigateToPrinting={onNavigateToPrinting} />)

    await waitFor(() => {
      expect(screen.getByText(/בקשת ההדפסה #1042/)).toBeInTheDocument()
    })
    expect(screen.getByText('#1042')).toBeInTheDocument()
    expect(screen.getByText('תזכורת על בקשה')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /בקשת הדפסה באיחור/ }))
    expect(markNotificationAsRead).toHaveBeenCalledWith('n-overdue')
    expect(onNavigateToPrinting).toHaveBeenCalledWith('print-req-1')
  })
})
