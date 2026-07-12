import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBodyScrollLockForTests } from '../../utils/bodyScrollLock'
import { RequestDetailsModal } from './RequestDetailsModal'

const loadRequestStatusHistory = vi.fn()
const loadRequestAttachments = vi.fn()
const loadRequestNotes = vi.fn()

vi.mock('../../services/requests', () => ({
  loadRequestStatusHistory: (...args: unknown[]) => loadRequestStatusHistory(...args),
}))

vi.mock('../../services/attachments', () => ({
  loadRequestAttachments: (...args: unknown[]) => loadRequestAttachments(...args),
  createAttachmentSignedUrl: vi.fn(),
}))

vi.mock('../../services/notes', () => ({
  loadRequestNotes: (...args: unknown[]) => loadRequestNotes(...args),
}))

afterEach(() => {
  cleanup()
  resetBodyScrollLockForTests()
  vi.clearAllMocks()
})

beforeEach(() => {
  loadRequestStatusHistory.mockResolvedValue({
    ok: true,
    entries: [
      {
        id: 'hist-1',
        request_id: 'req-1',
        status: 'new',
        changed_at: '2026-07-01T10:00:00.000Z',
        changed_by_full_name: 'מזכירה',
      },
    ],
  })
  loadRequestAttachments.mockResolvedValue({ ok: true, attachments: [] })
  loadRequestNotes.mockResolvedValue({ ok: true, notes: [] })
})

const teacherRequest = {
  role: 'teacher' as const,
  id: 'req-1',
  request_type: 'absence' as const,
  description: 'היעדרות',
  status: 'new' as const,
  created_at: '2026-07-01T10:00:00.000Z',
}

describe('RequestDetailsModal', () => {
  it('loads history only while open and shows summary fields', async () => {
    render(
      <RequestDetailsModal
        isOpen
        request={teacherRequest}
        onClose={() => undefined}
        showNotes={false}
      />,
    )

    expect(screen.getByRole('dialog', { name: /פרטי בקשה/ })).toBeInTheDocument()
    expect(screen.getByText('היעדרות')).toBeInTheDocument()

    await waitFor(() => {
      expect(loadRequestStatusHistory).toHaveBeenCalledWith('req-1')
    })
  })

  it('restores focus to the originating row when closed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const row = document.createElement('tr')
    row.tabIndex = 0
    document.body.appendChild(row)
    row.focus()

    render(
      <RequestDetailsModal
        isOpen
        request={teacherRequest}
        returnFocusElement={row}
        onClose={onClose}
        showNotes={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'סגירת פרטי בקשה' }))

    expect(onClose).toHaveBeenCalled()
    await waitFor(() => {
      expect(document.activeElement).toBe(row)
    })

    row.remove()
  })
})
