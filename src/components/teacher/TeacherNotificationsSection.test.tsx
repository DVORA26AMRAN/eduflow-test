import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED } from '../../types/teacherNotification'
import { TeacherNotificationsSection } from './TeacherNotificationsSection'

const loadNotifications = vi.fn()
const markNotificationAsRead = vi.fn()
const loadTeacherRequestNotificationContexts = vi.fn()
const subscribeToTeacherNotifications = vi.fn()
const unsubscribeFromTeacherNotifications = vi.fn()

vi.mock('../../services/notifications', () => ({
  loadNotifications: (...args: unknown[]) => loadNotifications(...args),
  markNotificationAsRead: (...args: unknown[]) => markNotificationAsRead(...args),
  subscribeToTeacherNotifications: (...args: unknown[]) => subscribeToTeacherNotifications(...args),
  unsubscribeFromTeacherNotifications: (...args: unknown[]) =>
    unsubscribeFromTeacherNotifications(...args),
}))

vi.mock('../../services/teacherNotificationRequests', () => ({
  loadTeacherRequestNotificationContexts: (...args: unknown[]) =>
    loadTeacherRequestNotificationContexts(...args),
}))

vi.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'teacher-1' } } }, error: null })),
    },
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  subscribeToTeacherNotifications.mockReturnValue({})
  markNotificationAsRead.mockResolvedValue({ ok: true })
})

describe('TeacherNotificationsSection', () => {
  it('loads request contexts in one batch for all notifications', async () => {
    loadNotifications.mockResolvedValue({
      ok: true,
      notifications: [
        {
          id: 'notif-1',
          notification_type: NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED,
          title: 'עדכון לבקשה שלך',
          message: 'הבקשה שלך סומנה כהושלמה.',
          is_read: false,
          metadata: { request_id: 'req-1' },
          created_at: '2026-07-01T10:00:00.000Z',
        },
        {
          id: 'notif-2',
          notification_type: NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED,
          title: 'עדכון לבקשה שלך',
          message: 'סטטוס הבקשה שלך עודכן.',
          is_read: false,
          metadata: { request_id: 'req-2' },
          created_at: '2026-07-02T10:00:00.000Z',
        },
      ],
    })

    loadTeacherRequestNotificationContexts.mockResolvedValue({
      ok: true,
      contexts: new Map([
        [
          'req-1',
          {
            requestId: 'req-1',
            requestType: 'absence',
            description: 'היעדרות',
            status: 'completed',
            archivedAt: null,
          },
        ],
        [
          'req-2',
          {
            requestId: 'req-2',
            requestType: 'general_request',
            description: 'נושא כללי',
            status: 'in_progress',
            archivedAt: null,
          },
        ],
      ]),
    })

    render(<TeacherNotificationsSection />)

    await waitFor(() => {
      expect(loadTeacherRequestNotificationContexts).toHaveBeenCalledTimes(1)
    })

    expect(loadTeacherRequestNotificationContexts).toHaveBeenCalledWith(['req-1', 'req-2'])
    expect(screen.getByText('עדכון לבקשת היעדרות')).toBeInTheDocument()
    expect(screen.getByText('עדכון לבקשה אחרת')).toBeInTheDocument()
  })

  it('marks unread notifications as read and navigates to the related request', async () => {
    const user = userEvent.setup()
    const onNavigateToRequest = vi.fn()

    loadNotifications.mockResolvedValue({
      ok: true,
      notifications: [
        {
          id: 'notif-1',
          notification_type: NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED,
          title: 'עדכון לבקשה שלך',
          message: 'הבקשה שלך סומנה כהושלמה.',
          is_read: false,
          metadata: { request_id: 'req-1' },
          created_at: '2026-07-01T10:00:00.000Z',
        },
      ],
    })

    loadTeacherRequestNotificationContexts.mockResolvedValue({
      ok: true,
      contexts: new Map([
        [
          'req-1',
          {
            requestId: 'req-1',
            requestType: 'absence',
            description: 'היעדרות',
            status: 'completed',
            archivedAt: null,
          },
        ],
      ]),
    })

    render(<TeacherNotificationsSection onNavigateToRequest={onNavigateToRequest} />)

    await screen.findByText('עדכון לבקשת היעדרות')

    const button = screen.getByRole('button')
    await user.click(button)

    expect(markNotificationAsRead).toHaveBeenCalledWith('notif-1')
    expect(onNavigateToRequest).toHaveBeenCalledWith(
      {
        requestId: 'req-1',
        requestType: 'absence',
        requestStatus: 'completed',
      },
      {
        archived: false,
        returnFocusElement: button,
      },
    )
    await waitFor(() => {
      expect(screen.queryByText('חדש')).not.toBeInTheDocument()
    })
  })
})
