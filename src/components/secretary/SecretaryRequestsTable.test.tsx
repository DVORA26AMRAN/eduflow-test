import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecretaryRequestsTable } from './SecretaryRequestsTable'

afterEach(() => {
  cleanup()
})

const request = {
  id: 'req-1',
  request_type: 'absence' as const,
  description: 'תיאור',
  status: 'in_progress' as const,
  created_at: '2026-07-01T10:00:00.000Z',
  teacher_full_name: 'מורה א',
}

const reminderSummary = new Map([
  [
    'req-1',
    {
      request_id: 'req-1',
      reminder_count: 2,
      latest_reminder_at: '2026-07-02T12:00:00.000Z',
    },
  ],
])

const baseProps = {
  requests: [request],
  emptyMessage: 'אין בקשות',
  updatingRequestId: null,
  archivingRequestId: null,
  requestIdsWithAttachments: new Set<string>(),
  unreadReminderRequestIds: new Set<string>(),
  unreadMessageRequestIds: new Set<string>(),
  requestIdsWithMessages: new Set<string>(),
  reminderSummariesByRequestId: reminderSummary,
  onStatusChange: vi.fn(),
  onOpenDetails: vi.fn(),
  onArchive: vi.fn(),
}

describe('SecretaryRequestsTable reminder rows', () => {
  it('shows reminder history even when notifications are read', () => {
    render(<SecretaryRequestsTable {...baseProps} />)

    expect(screen.getByText('התקבלה תזכורת · 2')).toBeInTheDocument()
  })

  it('highlights unread reminders without hiding historical reminder data', () => {
    const { container } = render(
      <SecretaryRequestsTable
        {...baseProps}
        unreadReminderRequestIds={new Set(['req-1'])}
        reminderSummariesByRequestId={reminderSummary}
      />,
    )

    expect(container.querySelector('.secretary-dashboard__row--reminder-received')).toBeTruthy()
    expect(screen.getByText('התקבלה תזכורת · 2')).toBeInTheDocument()
  })
})

describe('SecretaryRequestsTable conversation rows', () => {
  it('highlights rows with unread conversation messages', () => {
    const { container } = render(
      <SecretaryRequestsTable
        {...baseProps}
        unreadMessageRequestIds={new Set(['req-1'])}
        requestIdsWithMessages={new Set(['req-1'])}
      />,
    )

    expect(container.querySelector('.ds-table__row--unread-conversation')).toBeTruthy()
    expect(screen.getByText('הודעה חדשה')).toBeInTheDocument()
  })

  it('removes unread highlight after conversation is marked read', () => {
    const { container, rerender } = render(
      <SecretaryRequestsTable
        {...baseProps}
        unreadMessageRequestIds={new Set(['req-1'])}
        requestIdsWithMessages={new Set(['req-1'])}
      />,
    )

    expect(container.querySelector('.ds-table__row--unread-conversation')).toBeTruthy()

    rerender(
      <SecretaryRequestsTable
        {...baseProps}
        unreadMessageRequestIds={new Set()}
        requestIdsWithMessages={new Set(['req-1'])}
      />,
    )

    expect(container.querySelector('.ds-table__row--unread-conversation')).toBeNull()
    expect(screen.getByLabelText('יש שיחה בבקשה')).toBeInTheDocument()
  })

  it('shows no conversation indicator when the request has no messages', () => {
    render(<SecretaryRequestsTable {...baseProps} />)

    expect(screen.queryByLabelText('יש שיחה בבקשה')).not.toBeInTheDocument()
    expect(screen.queryByText('הודעה חדשה')).not.toBeInTheDocument()
  })

  it('keeps reminder badge visible alongside unread conversation badge', () => {
    render(
      <SecretaryRequestsTable
        {...baseProps}
        unreadReminderRequestIds={new Set(['req-1'])}
        unreadMessageRequestIds={new Set(['req-1'])}
        requestIdsWithMessages={new Set(['req-1'])}
      />,
    )

    expect(screen.getByText('התקבלה תזכורת · 2')).toBeInTheDocument()
    expect(screen.getByText('הודעה חדשה')).toBeInTheDocument()
  })

  it('applies unread highlight only for requests in the current user unread set', () => {
    const requests = [
      request,
      {
        ...request,
        id: 'req-2',
        teacher_full_name: 'מורה ב',
      },
    ]

    const { container } = render(
      <SecretaryRequestsTable
        {...baseProps}
        requests={requests}
        unreadMessageRequestIds={new Set(['req-1'])}
        requestIdsWithMessages={new Set(['req-1', 'req-2'])}
      />,
    )

    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0]?.classList.contains('ds-table__row--unread-conversation')).toBe(true)
    expect(rows[1]?.classList.contains('ds-table__row--unread-conversation')).toBe(false)
    expect(screen.getByText('הודעה חדשה')).toBeInTheDocument()
    expect(screen.getByLabelText('יש שיחה בבקשה')).toBeInTheDocument()
  })
})
