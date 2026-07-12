import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherRequestsList } from './TeacherRequestsList'

const onArchive = vi.fn()
const onSendReminder = vi.fn()
const onOpenDetails = vi.fn()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  onArchive.mockReset()
  onSendReminder.mockReset()
  onOpenDetails.mockReset()
})

const baseProps = {
  archivingRequestId: null,
  remindingRequestId: null,
  reminderStatesByRequestId: new Map(),
  onArchive,
  onSendReminder,
  onOpenDetails,
}

describe('TeacherRequestsList reminder bell', () => {
  it('shows the reminder bell for new requests', () => {
    render(
      <TeacherRequestsList
        {...baseProps}
        requests={[
          {
            id: 'req-new',
            request_type: 'absence',
            description: 'בקשה חדשה',
            status: 'new',
            created_at: '2026-07-01T10:00:00.000Z',
          },
        ]}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'שליחת תזכורת לבקשה חדשה' }),
    ).toBeInTheDocument()
  })

  it('shows the reminder bell for in_progress requests', () => {
    render(
      <TeacherRequestsList
        {...baseProps}
        requests={[
          {
            id: 'req-progress',
            request_type: 'absence',
            description: 'בקשה בטיפול',
            status: 'in_progress',
            created_at: '2026-07-01T10:00:00.000Z',
          },
        ]}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'שליחת תזכורת לבקשה בטיפול' }),
    ).toBeInTheDocument()
  })

  it('does not show the reminder bell for completed or rejected requests', () => {
    render(
      <TeacherRequestsList
        {...baseProps}
        requests={[
          {
            id: 'req-done',
            request_type: 'absence',
            description: 'בקשה הושלמה',
            status: 'completed',
            created_at: '2026-07-01T10:00:00.000Z',
          },
          {
            id: 'req-rejected',
            request_type: 'absence',
            description: 'בקשה נדחתה',
            status: 'rejected',
            created_at: '2026-07-02T10:00:00.000Z',
          },
        ]}
      />,
    )

    expect(screen.queryByRole('button', { name: /שליחת תזכורת/ })).not.toBeInTheDocument()
  })

  it('keeps the reminder bell disabled during cooldown after status changes', () => {
    render(
      <TeacherRequestsList
        {...baseProps}
        requests={[
          {
            id: 'req-progress',
            request_type: 'absence',
            description: 'בקשה בטיפול',
            status: 'in_progress',
            created_at: '2026-07-01T10:00:00.000Z',
          },
        ]}
        reminderStatesByRequestId={
          new Map([
            [
              'req-progress',
              {
                request_id: 'req-progress',
                reminder_count: 1,
                last_reminder_at: '2026-07-01T10:00:00.000Z',
                next_reminder_available_at: '2026-07-02T10:00:00.000Z',
              },
            ],
          ])
        }
      />,
    )

    expect(
      screen.getByRole('button', {
        name: 'ניתן לשלוח תזכורת נוספת רק לאחר תקופת ההמתנה',
      }),
    ).toBeDisabled()
  })

  it('calls onSendReminder when the bell is clicked', async () => {
    const user = userEvent.setup()
    render(
      <TeacherRequestsList
        {...baseProps}
        requests={[
          {
            id: 'req-new',
            request_type: 'absence',
            description: 'בקשה חדשה',
            status: 'new',
            created_at: '2026-07-01T10:00:00.000Z',
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'שליחת תזכורת לבקשה חדשה' }))

    expect(onSendReminder).toHaveBeenCalledTimes(1)
    expect(onSendReminder.mock.calls[0][0].id).toBe('req-new')
  })

  it('opens details when clicking the row but not when clicking the reminder bell', async () => {
    const user = userEvent.setup()
    render(
      <TeacherRequestsList
        {...baseProps}
        requests={[
          {
            id: 'req-new',
            request_type: 'absence',
            description: 'בקשה חדשה',
            status: 'new',
            created_at: '2026-07-01T10:00:00.000Z',
          },
        ]}
      />,
    )

    await user.click(screen.getByText('בקשה חדשה'))
    expect(onOpenDetails).toHaveBeenCalledTimes(1)
    expect(onOpenDetails.mock.calls[0][0].id).toBe('req-new')

    await user.click(screen.getByRole('button', { name: 'שליחת תזכורת לבקשה חדשה' }))
    expect(onOpenDetails).toHaveBeenCalledTimes(1)
    expect(onSendReminder).toHaveBeenCalledTimes(1)
  })
})
