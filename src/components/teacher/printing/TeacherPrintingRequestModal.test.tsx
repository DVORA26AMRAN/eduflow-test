import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeacherPrintingRequestModal } from './TeacherPrintingRequestModal'

const createPrintingRequest = vi.fn()
const uploadPrintingFile = vi.fn()

vi.mock('../../../services/printingRequests', () => ({
  createPrintingRequest: (...args: unknown[]) => createPrintingRequest(...args),
  updatePrintingRequest: vi.fn(),
  uploadPrintingFile: (...args: unknown[]) => uploadPrintingFile(...args),
}))

vi.mock('../../ui/Modal', () => ({
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean
    title: string
    children: React.ReactNode
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  ConfirmDialog: ({
    isOpen,
    title,
  }: {
    isOpen: boolean
    title: string
  }) => (isOpen ? <div role="alertdialog">{title}</div> : null),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderModal() {
  const onClose = vi.fn()
  const onSubmitted = vi.fn()
  render(
    <div dir="rtl">
      <TeacherPrintingRequestModal
        isOpen
        mode="create"
        teacherFullName="דנה כהן"
        teacherUserId="teacher-1"
        institutionTimeZone="Asia/Jerusalem"
        minimumPrintNoticeMinutes={60}
        onClose={onClose}
        onSubmitted={onSubmitted}
      />
    </div>,
  )
  return { onClose, onSubmitted }
}

function setDeadline() {
  fireEvent.change(screen.getByLabelText('נדרש לתאריך'), { target: { value: '2099-08-06' } })
  fireEvent.change(screen.getByLabelText('שעה'), { target: { value: '11:00' } })
}

describe('TeacherPrintingRequestModal', () => {
  it('shows read-only teacher name and requires at least one file', () => {
    renderModal()
    expect(screen.getByDisplayValue('דנה כהן')).toHaveAttribute('readonly')
    expect(screen.getByText(/יש להוסיף לפחות קובץ אחד/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'המשך לסיכום' })).toBeDisabled()
  })

  it(
    'submits two files after summary and shows backend request number',
    async () => {
      const user = userEvent.setup({ delay: null })
      createPrintingRequest.mockResolvedValue({
        ok: true,
        printing_request_id: 'req-1',
        request_number: 1042,
        items: [
          { id: 'i1', storage_object_path: 'a/b/c/1', display_order: 1 },
          { id: 'i2', storage_object_path: 'a/b/c/2', display_order: 2 },
        ],
      })
      uploadPrintingFile.mockResolvedValue({ ok: true })

      const { onSubmitted } = renderModal()
      setDeadline()

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      await user.upload(fileInput, [
        new File([new Uint8Array([1, 2, 3])], 'worksheet.pdf', { type: 'application/pdf' }),
        new File([new Uint8Array([4, 5, 6])], 'cover.png', { type: 'image/png' }),
      ])

      await waitFor(() => {
        expect(screen.getByText('worksheet.pdf')).toBeInTheDocument()
        expect(screen.getByText('cover.png')).toBeInTheDocument()
      })

      const continueBtn = screen.getByRole('button', { name: 'המשך לסיכום' })
      await waitFor(() => expect(continueBtn).not.toBeDisabled())
      await user.click(continueBtn)

      expect(screen.getByText(/סיכום בקשת הדפסה/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'שלח בקשת הדפסה' }))

      await waitFor(() => {
        expect(createPrintingRequest).toHaveBeenCalledTimes(1)
        expect(uploadPrintingFile).toHaveBeenCalledTimes(2)
        expect(onSubmitted).toHaveBeenCalledWith({
          requestNumber: 1042,
          printingRequestId: 'req-1',
        })
        expect(screen.getByText(/בקשת הדפסה #1042 נשלחה בהצלחה/)).toBeInTheDocument()
      })
    },
    20000,
  )

  it(
    'maps PRINT_REQUEST_TOO_LATE from backend rejection',
    async () => {
      const user = userEvent.setup({ delay: null })
      createPrintingRequest.mockResolvedValue({
        ok: false,
        error_code: 'PRINT_REQUEST_TOO_LATE',
      })

      renderModal()
      setDeadline()
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      await user.upload(
        fileInput,
        new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' }),
      )
      const continueBtn = screen.getByRole('button', { name: 'המשך לסיכום' })
      await waitFor(() => expect(continueBtn).not.toBeDisabled())
      await user.click(continueBtn)
      await user.click(screen.getByRole('button', { name: 'שלח בקשת הדפסה' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/מראש|מאוחר יותר/)
      })
    },
    20000,
  )
})
