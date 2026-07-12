import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherCreateRequestModal } from './TeacherCreateRequestModal'

const onClose = vi.fn()
const onSubmit = vi.fn()

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
  vi.clearAllMocks()
})

beforeEach(() => {
  onClose.mockReset()
  onSubmit.mockReset()
})

function renderModal(
  requestType: 'absence' | 'budget_or_equipment' | 'general_request' = 'absence',
) {
  render(
    <div dir="rtl">
      <TeacherCreateRequestModal
        requestType={requestType}
        formKey={1}
        isSubmitting={false}
        submitMessage=""
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </div>,
  )
}

async function fillGeneralRequestForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'מזכירה' }))
  await user.type(screen.getByLabelText('נושא'), 'נושא לבדיקה')
  await user.type(screen.getByLabelText('הודעה'), 'הודעה לבדיקה')
}

describe('TeacherCreateRequestModal', () => {
  it('opens every request type inside the modal dialog', () => {
    const requestTypes = [
      { type: 'absence' as const, label: 'היעדרויות' },
      { type: 'budget_or_equipment' as const, label: 'בקשת תקציב / ציוד' },
      { type: 'general_request' as const, label: 'בקשה אחרת' },
    ]

    for (const requestType of requestTypes) {
      cleanup()
      renderModal(requestType.type)

      expect(screen.getByRole('dialog', { name: requestType.label })).toBeInTheDocument()
    }
  })

  it('closes from the X button when the form is empty', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: 'סגירת טופס בקשה' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('יש שינויים שלא נשמרו')).not.toBeInTheDocument()
  })

  it('closes from the cancel button when the form is empty', async () => {
    const user = userEvent.setup()
    renderModal('general_request')

    await user.click(screen.getByRole('button', { name: 'ביטול' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when clicking outside the modal if the form is empty', async () => {
    renderModal()

    const overlay = document.querySelector('.ds-modal-overlay')
    expect(overlay).toBeTruthy()

    if (overlay) {
      fireEvent.click(overlay)
    }

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when pressing Escape if the form is empty', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows unsaved-changes confirmation before closing a dirty general request form', async () => {
    const user = userEvent.setup()
    renderModal('general_request')

    await fillGeneralRequestForm(user)
    await user.click(screen.getByRole('button', { name: 'ביטול' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'יש שינויים שלא נשמרו. האם לסגור את הטופס?',
    )
  })

  it('closes without saving after confirming discard', async () => {
    const user = userEvent.setup()
    renderModal('general_request')

    await fillGeneralRequestForm(user)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'סגור ללא שמירה' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the modal open when submit errors are shown', () => {
    cleanup()
    render(
      <div dir="rtl">
        <TeacherCreateRequestModal
          requestType="general_request"
          formKey={1}
          isSubmitting={false}
          submitMessage="שליחת הבקשה נכשלה"
          onClose={onClose}
          onSubmit={onSubmit}
        />
      </div>,
    )

    expect(screen.getByRole('dialog', { name: 'בקשה אחרת' })).toBeInTheDocument()
    expect(screen.getByText('שליחת הבקשה נכשלה')).toBeInTheDocument()
  })

  it('renders RTL layout and modal structure for mobile-friendly scrolling', () => {
    renderModal()

    const dialog = screen.getByRole('dialog', { name: 'היעדרויות' })
    expect(dialog.closest('[dir="rtl"]')).toBeTruthy()
    expect(dialog.closest('.ds-modal-overlay')?.getAttribute('dir')).toBe('rtl')
    expect(dialog.className).toContain('ds-modal')
    expect(within(dialog).getByText('היעדרויות')).toBeInTheDocument()
    expect(document.querySelector('.ds-modal__body')).toBeInTheDocument()
  })

  it('renders the modal overlay as a direct child of document.body', () => {
    renderModal()

    const overlay = document.querySelector('.ds-modal-overlay')
    expect(overlay?.parentElement).toBe(document.body)
  })

  it('locks background scrolling while the modal is open', () => {
    renderModal()

    expect(document.body.style.overflow).toBe('hidden')
  })

  it('traps keyboard focus inside the modal', async () => {
    const user = userEvent.setup()
    renderModal('general_request')

    const dialog = screen.getByRole('dialog', { name: 'בקשה אחרת' })

    for (let index = 0; index < 6; index += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('requires recipient, subject, and message before submitting a general request', async () => {
    const user = userEvent.setup()
    renderModal('general_request')

    await user.click(screen.getByRole('button', { name: 'שליחת בקשה' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('נא לבחור נמען לבקשה.')).toBeInTheDocument()
  })
})
