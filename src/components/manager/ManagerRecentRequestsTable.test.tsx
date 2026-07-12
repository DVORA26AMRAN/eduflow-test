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
    status: 'completed' as const,
    created_at: '2026-07-01T10:00:00.000Z',
  },
  {
    id: 'req-2',
    teacher_full_name: 'מורה ב',
    request_type: 'budget_or_equipment' as const,
    status: 'new' as const,
    created_at: '2026-07-02T10:00:00.000Z',
  },
  {
    id: 'req-3',
    teacher_full_name: 'מורה ג',
    request_type: 'substitute_teacher' as const,
    status: 'in_progress' as const,
    created_at: '2026-07-03T10:00:00.000Z',
  },
  {
    id: 'req-4',
    teacher_full_name: 'מורה ד',
    request_type: 'absence' as const,
    status: 'rejected' as const,
    created_at: '2026-07-04T10:00:00.000Z',
  },
]

describe('ManagerRecentRequestsTable archive actions', () => {
  it('shows an enabled archive action for every request row regardless of status', () => {
    render(
      <ManagerRecentRequestsTable
        requests={sampleRequests}
        archivingRequestId={null}
        onArchive={vi.fn()}
      />,
    )

    const archiveButtons = screen.getAllByRole('button', { name: /העבר לארכיון אישי בקשה של/ })
    expect(archiveButtons).toHaveLength(sampleRequests.length)
    archiveButtons.forEach((button) => {
      expect(button).toBeEnabled()
    })
  })
})
