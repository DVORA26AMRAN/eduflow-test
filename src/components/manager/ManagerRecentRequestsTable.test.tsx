import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagerRecentRequestsTable } from './ManagerRecentRequestsTable'

afterEach(() => {
  cleanup()
})

const sampleRequests = [
  {
    id: 'req-1',
    teacher_full_name: 'מורה א',
    request_type: 'absence' as const,
    description: 'היעדרות ביום ראשון',
    status: 'in_progress' as const,
    created_at: '2026-07-01T10:00:00.000Z',
  },
]

const baseProps = {
  requests: sampleRequests,
  archivingRequestId: null,
  unreadReminderRequestIds: new Set<string>(),
  unreadMessageRequestIds: new Set<string>(),
  requestIdsWithMessages: new Set<string>(),
  reminderSummariesByRequestId: new Map(),
  onArchive: vi.fn(),
  onOpenDetails: vi.fn(),
}

describe('ManagerRecentRequestsTable', () => {
  it('shows an enabled archive action for every request row regardless of status', () => {
    render(<ManagerRecentRequestsTable {...baseProps} />)

    const archiveButtons = screen.getAllByRole('button', { name: /העבר לארכיון אישי בקשה של/ })
    expect(archiveButtons).toHaveLength(sampleRequests.length)
    archiveButtons.forEach((button) => {
      expect(button).toBeEnabled()
    })
  })

  it('shows the request description in the same column as the secretary table', () => {
    render(<ManagerRecentRequestsTable {...baseProps} />)

    expect(screen.getByRole('columnheader', { name: 'תיאור' })).toBeInTheDocument()
    expect(screen.getByText('היעדרות ביום ראשון')).toBeInTheDocument()
  })

  it('shows reminder count and latest timestamp on the request row', () => {
    render(
      <ManagerRecentRequestsTable
        {...baseProps}
        reminderSummariesByRequestId={
          new Map([
            [
              'req-1',
              {
                request_id: 'req-1',
                reminder_count: 3,
                latest_reminder_at: '2026-07-03T08:00:00.000Z',
              },
            ],
          ])
        }
      />,
    )

    expect(screen.getByText('התקבלה תזכורת · 3')).toBeInTheDocument()
  })

  it('keeps reminder history visible after notifications are read', () => {
    render(
      <ManagerRecentRequestsTable
        {...baseProps}
        reminderSummariesByRequestId={
          new Map([
            [
              'req-1',
              {
                request_id: 'req-1',
                reminder_count: 2,
                latest_reminder_at: '2026-07-03T08:00:00.000Z',
              },
            ],
          ])
        }
      />,
    )

    expect(screen.getByText('התקבלה תזכורת · 2')).toBeInTheDocument()
    expect(screen.queryByText('חדש')).not.toBeInTheDocument()
  })

  it('highlights unread conversation per request id set', () => {
    const { container } = render(
      <ManagerRecentRequestsTable
        {...baseProps}
        unreadMessageRequestIds={new Set(['req-1'])}
        requestIdsWithMessages={new Set(['req-1'])}
      />,
    )

    expect(container.querySelector('.ds-table__row--unread-conversation')).toBeTruthy()
    expect(screen.getByText('הודעה חדשה')).toBeInTheDocument()
  })
})
