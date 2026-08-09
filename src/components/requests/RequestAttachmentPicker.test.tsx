import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  REQUEST_ATTACHMENT_PICK_BUTTON_LABEL,
  RequestAttachmentPicker,
} from './RequestAttachmentPicker'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RequestAttachmentPicker', () => {
  it('shows an EduFlow pick button instead of native file-status chrome', () => {
    render(
      <div dir="rtl">
        <RequestAttachmentPicker selectedFile={null} onSelectedFileChange={vi.fn()} />
      </div>,
    )

    expect(
      screen.getByRole('button', { name: REQUEST_ATTACHMENT_PICK_BUTTON_LABEL }),
    ).toBeInTheDocument()
    expect(screen.queryByText('לא נבחר קובץ')).not.toBeInTheDocument()
    expect(screen.getByText('קובץ מצורף')).toBeInTheDocument()
  })

  it('displays the original selected filename after picking a file', async () => {
    const user = userEvent.setup({ delay: null })
    const onSelectedFileChange = vi.fn()
    const { rerender } = render(
      <div dir="rtl">
        <RequestAttachmentPicker
          selectedFile={null}
          onSelectedFileChange={onSelectedFileChange}
          inputId="attachment-test"
        />
      </div>,
    )

    const input = document.getElementById('attachment-test') as HTMLInputElement
    const file = new File(['proof'], 'אישור-מחלה.pdf', { type: 'application/pdf' })
    await user.upload(input, file)

    expect(onSelectedFileChange).toHaveBeenCalledWith(file)

    rerender(
      <div dir="rtl">
        <RequestAttachmentPicker
          selectedFile={file}
          onSelectedFileChange={onSelectedFileChange}
          inputId="attachment-test"
        />
      </div>,
    )

    expect(screen.getByText('אישור-מחלה.pdf')).toBeInTheDocument()
  })

  it('supports keyboard focus on the pick button', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <div dir="rtl">
        <RequestAttachmentPicker selectedFile={null} onSelectedFileChange={vi.fn()} />
      </div>,
    )

    await user.tab()
    expect(
      screen.getByRole('button', { name: REQUEST_ATTACHMENT_PICK_BUTTON_LABEL }),
    ).toHaveFocus()
  })

  it('opens the hidden file input when the pick button is activated', () => {
    render(
      <div dir="rtl">
        <RequestAttachmentPicker
          selectedFile={null}
          onSelectedFileChange={vi.fn()}
          inputId="attachment-click"
        />
      </div>,
    )

    const input = document.getElementById('attachment-click') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')

    fireEvent.click(screen.getByRole('button', { name: REQUEST_ATTACHMENT_PICK_BUTTON_LABEL }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})
