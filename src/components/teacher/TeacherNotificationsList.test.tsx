import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED } from '../../types/teacherNotification'
import { TeacherNotificationsList } from './TeacherNotificationsList'

afterEach(() => {
  cleanup()
})

describe('TeacherNotificationsList', () => {
  it('shows request type, context, and event for request notifications', () => {
    render(
      <TeacherNotificationsList
        notifications={[
          {
            id: 'notif-1',
            notification_type: NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED,
            title: 'עדכון לבקשה שלך',
            message: 'הבקשה שלך סומנה כהושלמה.',
            is_read: false,
            metadata: { request_id: 'req-1' },
            created_at: '2026-07-01T10:00:00.000Z',
          },
        ]}
        requestContextsById={
          new Map([
            [
              'req-1',
              {
                requestId: 'req-1',
                requestType: 'absence',
                description: 'היעדרות בתאריך 15 ביולי',
                status: 'completed',
                archivedAt: null,
              },
            ],
          ])
        }
        onNotificationClick={vi.fn()}
      />,
    )

    expect(screen.getByText('עדכון לבקשת היעדרות')).toBeInTheDocument()
    expect(screen.getByText('היעדרות בתאריך 15 ביולי')).toBeInTheDocument()
    expect(screen.getByText('הבקשה שלך סומנה כהושלמה.')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('עדכון לבקשת היעדרות'),
    )
  })

  it('keeps unrelated notifications unchanged', () => {
    render(
      <TeacherNotificationsList
        notifications={[
          {
            id: 'notif-sub',
            notification_type: 'SUBSTITUTE_BOARD_APPROVED',
            title: 'מילוי המקום אושר',
            message: 'ההחלפה אושרה.',
            is_read: false,
            metadata: { substitute_board_post_id: 'post-1' },
            created_at: '2026-07-01T10:00:00.000Z',
          },
        ]}
        requestContextsById={new Map()}
        onNotificationClick={vi.fn()}
      />,
    )

    expect(screen.getByText('מילוי המקום אושר')).toBeInTheDocument()
    expect(screen.queryByText('עדכון לבקשת')).not.toBeInTheDocument()
    expect(screen.getByText('ההחלפה אושרה.')).toBeInTheDocument()
  })

  it('calls click handler with the notification button element', async () => {
    const user = userEvent.setup()
    const onNotificationClick = vi.fn()

    render(
      <TeacherNotificationsList
        notifications={[
          {
            id: 'notif-1',
            notification_type: NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED,
            title: 'עדכון לבקשה שלך',
            message: 'הבקשה שלך סומנה כהושלמה.',
            is_read: true,
            metadata: { request_id: 'req-1' },
            created_at: '2026-07-01T10:00:00.000Z',
          },
        ]}
        requestContextsById={new Map()}
        onNotificationClick={onNotificationClick}
      />,
    )

    const button = screen.getByRole('button')
    await user.click(button)

    expect(onNotificationClick).toHaveBeenCalledWith('notif-1', button)
  })
})
