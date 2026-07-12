import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherRequestsSection } from './TeacherRequestsSection'

vi.mock('../../services/requests', () => ({
  loadTeacherRequests: vi.fn(async () => ({ ok: true, requests: [] })),
  createTeacherRequest: vi.fn(),
  archiveRequest: vi.fn(),
}))

vi.mock('../../services/requestReminders', () => ({
  loadTeacherRequestReminderStates: vi.fn(async () => ({ ok: true, states: [] })),
  sendRequestReminder: vi.fn(),
}))

vi.mock('../../services/attachments', () => ({
  uploadRequestAttachment: vi.fn(),
  validateRequestAttachment: vi.fn(() => ({ ok: true })),
}))

import { createTeacherRequest, loadTeacherRequests } from '../../services/requests'
import { resetBodyScrollLockForTests } from '../../utils/bodyScrollLock'

const onArchived = vi.fn()

afterEach(() => {
  cleanup()
  resetBodyScrollLockForTests()
  document.body.style.overflow = ''
  vi.clearAllMocks()
})

beforeEach(() => {
  onArchived.mockReset()
  vi.mocked(loadTeacherRequests).mockResolvedValue({ ok: true, requests: [] })
})

function renderSection() {
  render(
    <div dir="rtl">
      <TeacherRequestsSection refreshToken={0} onArchived={onArchived} />
    </div>,
  )
}

async function expandRequestsSection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'הבקשות שלי' }))
}

async function fillGeneralRequestForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'מזכירה' }))
  await user.type(screen.getByLabelText('נושא'), 'נושא לבדיקה')
  await user.type(screen.getByLabelText('הודעה'), 'הודעה לבדיקה')
}

describe('TeacherRequestsSection modal create flow', () => {
  it('does not render request fields inline before a category is selected', async () => {
    const user = userEvent.setup({ delay: null })
    renderSection()
    await expandRequestsSection(user)

    expect(screen.getByText('פתיחת בקשה חדשה')).toBeInTheDocument()
    expect(screen.queryByLabelText('תאריך היעדרות')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('נושא')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not show מילוי מקום as a teacher request category card', async () => {
    const user = userEvent.setup({ delay: null })
    renderSection()
    await expandRequestsSection(user)

    expect(screen.queryByRole('radio', { name: /מילוי מקום/ })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /בקשה אחרת/ })).toBeInTheDocument()
    expect(screen.getByText('פנייה חופשית למזכירה או למנהלת')).toBeInTheDocument()
  })

  it('opens the selected request type inside a modal for every category', async () => {
    const user = userEvent.setup({ delay: null })
    renderSection()
    await expandRequestsSection(user)

    const categories = [
      { name: /היעדרויות/, fieldLabel: 'תאריך היעדרות', dialogName: 'היעדרויות' },
      { name: /בקשת תקציב/, fieldLabel: 'פירוט הבקשה', dialogName: 'בקשת תקציב / ציוד' },
      { name: /בקשה אחרת/, fieldLabel: 'נושא', dialogName: 'בקשה אחרת' },
    ]

    for (const category of categories) {
      await user.click(screen.getByRole('radio', { name: category.name }))
      expect(screen.getByRole('dialog', { name: category.dialogName })).toBeInTheDocument()
      expect(screen.getByLabelText(category.fieldLabel)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'סגירת טופס בקשה' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  }, 15000)

  it('allows only one create modal at a time', async () => {
    const user = userEvent.setup({ delay: null })
    renderSection()
    await expandRequestsSection(user)

    await user.click(screen.getByRole('radio', { name: /היעדרויות/ }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    const generalRequestCategory = screen.getByRole('radio', { name: /בקשה אחרת/ })
    expect(generalRequestCategory).toBeDisabled()
  })

  it('closes the modal and refreshes requests after a successful general request submit', async () => {
    const user = userEvent.setup({ delay: null })
    vi.mocked(createTeacherRequest).mockResolvedValue({
      ok: true,
      requestId: 'req-1',
    })

    renderSection()
    await expandRequestsSection(user)

    await user.click(screen.getByRole('radio', { name: /בקשה אחרת/ }))
    await fillGeneralRequestForm(user)
    await user.click(screen.getByRole('button', { name: 'שליחת בקשה' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    expect(createTeacherRequest).toHaveBeenCalledWith({
      requestType: 'general_request',
      description: 'נושא לבדיקה',
      requestPayload: { message: 'הודעה לבדיקה' },
      recipientRole: 'secretary',
    })
    expect(loadTeacherRequests).toHaveBeenCalledTimes(2)
    expect(screen.getByText('בקשה נשלחה בהצלחה.')).toBeInTheDocument()
  })

  it('keeps the modal open when submit fails', async () => {
    const user = userEvent.setup({ delay: null })
    vi.mocked(createTeacherRequest).mockResolvedValue({
      ok: false,
      errorMessage: 'שליחת הבקשה נכשלה',
    })

    renderSection()
    await expandRequestsSection(user)

    await user.click(screen.getByRole('radio', { name: /בקשה אחרת/ }))
    await fillGeneralRequestForm(user)
    await user.click(screen.getByRole('button', { name: 'שליחת בקשה' }))

    await waitFor(() => {
      expect(screen.getAllByText('שליחת הבקשה נכשלה')).toHaveLength(1)
    })

    expect(screen.getByRole('dialog', { name: 'בקשה אחרת' })).toBeInTheDocument()
  }, 15000)
})
