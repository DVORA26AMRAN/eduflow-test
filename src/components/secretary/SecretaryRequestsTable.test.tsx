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

describe('SecretaryRequestsTable reminder rows', () => {
  it('shows reminder history even when notifications are read', () => {
    render(
      <SecretaryRequestsTable
        requests={[request]}
        emptyMessage="אין בקשות"
        updatingRequestId={null}
        archivingRequestId={null}
        requestIdsWithAttachments={new Set()}
        unreadReminderRequestIds={new Set()}
        reminderSummariesByRequestId={
          new Map([
            [
              'req-1',
              {
                request_id: 'req-1',
                reminder_count: 2,
                latest_reminder_at: '2026-07-02T12:00:00.000Z',
              },
            ],
          ])
        }
        onStatusChange={vi.fn()}
        onShowHistory={vi.fn()}
        onShowNotes={vi.fn()}
        onArchive={vi.fn()}
        onOpenDetails={vi.fn()}
      />,
    )

    expect(screen.getByText('התקבלה תזכורת · 2')).toBeInTheDocument()
  })

  it('highlights unread reminders without hiding historical reminder data', () => {
    const { container } = render(
      <SecretaryRequestsTable
        requests={[request]}
        emptyMessage="אין בקשות"
        updatingRequestId={null}
        archivingRequestId={null}
        requestIdsWithAttachments={new Set()}
        unreadReminderRequestIds={new Set(['req-1'])}
        reminderSummariesByRequestId={
          new Map([
            [
              'req-1',
              {
                request_id: 'req-1',
                reminder_count: 1,
                latest_reminder_at: '2026-07-02T12:00:00.000Z',
              },
            ],
          ])
        }
        onStatusChange={vi.fn()}
        onShowHistory={vi.fn()}
        onShowNotes={vi.fn()}
        onArchive={vi.fn()}
        onOpenDetails={vi.fn()}
      />,
    )

    expect(container.querySelector('.secretary-dashboard__row--reminder-received')).toBeTruthy()
    expect(screen.getByText('התקבלה תזכורת')).toBeInTheDocument()
  })
})
