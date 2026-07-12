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
    status: 'in_progress' as const,
    created_at: '2026-07-01T10:00:00.000Z',
  },
]

describe('ManagerRecentRequestsTable', () => {
  it('shows an enabled archive action for every request row regardless of status', () => {
    render(
      <ManagerRecentRequestsTable
        requests={sampleRequests}
        archivingRequestId={null}
        unreadReminderRequestIds={new Set()}
        reminderSummariesByRequestId={new Map()}
        onArchive={vi.fn()}
      />,
    )

    const archiveButtons = screen.getAllByRole('button', { name: /העבר לארכיון אישי בקשה של/ })
    expect(archiveButtons).toHaveLength(sampleRequests.length)
    archiveButtons.forEach((button) => {
      expect(button).toBeEnabled()
    })
  })

  it('shows reminder count and latest timestamp on the request row', () => {
    render(
      <ManagerRecentRequestsTable
        requests={sampleRequests}
        archivingRequestId={null}
        unreadReminderRequestIds={new Set()}
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
        onArchive={vi.fn()}
      />,
    )

    expect(screen.getByText('התקבלה תזכורת · 3')).toBeInTheDocument()
  })

  it('keeps reminder history visible after notifications are read', () => {
    render(
      <ManagerRecentRequestsTable
        requests={sampleRequests}
        archivingRequestId={null}
        unreadReminderRequestIds={new Set()}
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
        onArchive={vi.fn()}
      />,
    )

    expect(screen.getByText('התקבלה תזכורת · 2')).toBeInTheDocument()
    expect(screen.queryByText('חדש')).not.toBeInTheDocument()
  })
})
