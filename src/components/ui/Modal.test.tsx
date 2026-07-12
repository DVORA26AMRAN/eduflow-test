import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetBodyScrollLockForTests } from '../../utils/bodyScrollLock'
import { ConfirmDialog, Modal } from './Modal'

afterEach(() => {
  cleanup()
  resetBodyScrollLockForTests()
})

describe('Modal', () => {
  it('renders with the requested size class', () => {
    render(
      <Modal isOpen title="כותרת" size="large" onClose={() => undefined}>
        תוכן
      </Modal>,
    )

    expect(document.querySelector('.ds-modal--large')).toBeInTheDocument()
  })

  it('locks page scrolling while open and restores it on close', () => {
    Object.defineProperty(window, 'scrollY', { value: 240, writable: true })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    const { rerender } = render(
      <Modal isOpen title="כותרת" onClose={() => undefined}>
        תוכן
      </Modal>,
    )

    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-240px')

    rerender(
      <Modal isOpen={false} title="כותרת" onClose={() => undefined}>
        תוכן
      </Modal>,
    )

    expect(document.body.style.position).toBe('')
    expect(scrollTo).toHaveBeenCalledWith(0, 240)
  })

  it('scrolls only inside the modal body container', () => {
    render(
      <Modal isOpen title="כותרת" onClose={() => undefined}>
        תוכן
      </Modal>,
    )

    const body = document.querySelector('.ds-modal__body')
    expect(body).toBeTruthy()
    expect(getComputedStyle(body as Element).overflowY).toBe('auto')
  })
})

describe('ConfirmDialog', () => {
  it('uses alertdialog semantics and small modal sizing', () => {
    render(
      <ConfirmDialog
        isOpen
        title="אישור"
        message="הודעה"
        continueLabel="ביטול"
        confirmLabel="אישור"
        onContinue={() => undefined}
        onConfirm={() => undefined}
      />,
    )

    expect(screen.getByRole('alertdialog', { name: 'אישור' })).toBeInTheDocument()
    expect(document.querySelector('.ds-modal--small')).toBeInTheDocument()
  })

  it('dismisses from backdrop when closeOnBackdropClick is enabled', async () => {
    const onContinue = vi.fn()

    render(
      <ConfirmDialog
        isOpen
        title="אישור"
        message="הודעה"
        continueLabel="ביטול"
        confirmLabel="אישור"
        closeOnBackdropClick
        onContinue={onContinue}
        onConfirm={() => undefined}
      />,
    )

    const overlay = document.querySelector('.ds-modal-overlay--confirm')
    expect(overlay).toBeTruthy()

    if (overlay) {
      fireEvent.click(overlay)
    }

    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('calls onContinue when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()

    render(
      <ConfirmDialog
        isOpen
        title="אישור"
        message="הודעה"
        continueLabel="ביטול"
        confirmLabel="אישור"
        onContinue={onContinue}
        onConfirm={() => undefined}
      />,
    )

    await user.keyboard('{Escape}')
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
