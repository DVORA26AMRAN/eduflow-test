import { cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, Modal } from '../components/ui/Modal'
import {
  acquireBodyScrollLock,
  getBodyScrollLockCountForTests,
  releaseBodyScrollLock,
  resetBodyScrollLockForTests,
} from './bodyScrollLock'

function setupScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', { value, writable: true, configurable: true })
}

afterEach(() => {
  cleanup()
  resetBodyScrollLockForTests()
})

describe('bodyScrollLock utility', () => {
  beforeEach(() => {
    setupScrollY(320)
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.left = ''
    document.body.style.right = ''
    document.body.style.width = ''
    document.body.style.overflow = ''
  })

  it('locks body scrolling on first acquire', () => {
    acquireBodyScrollLock()

    expect(getBodyScrollLockCountForTests()).toBe(1)
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-320px')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('keeps body locked while nested acquires remain active', () => {
    acquireBodyScrollLock()
    acquireBodyScrollLock()

    expect(getBodyScrollLockCountForTests()).toBe(2)
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-320px')
  })

  it('does not restore scrolling until the final release', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    acquireBodyScrollLock()
    acquireBodyScrollLock()

    releaseBodyScrollLock()

    expect(getBodyScrollLockCountForTests()).toBe(1)
    expect(document.body.style.position).toBe('fixed')
    expect(scrollTo).not.toHaveBeenCalled()

    releaseBodyScrollLock()

    expect(getBodyScrollLockCountForTests()).toBe(0)
    expect(document.body.style.position).toBe('')
    expect(scrollTo).toHaveBeenCalledWith(0, 320)
  })

  it('restores the original body styles exactly after the final release', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    document.body.style.position = 'relative'
    document.body.style.top = '12px'
    document.body.style.left = '4px'
    document.body.style.right = '8px'
    document.body.style.width = '90%'
    document.body.style.overflow = 'scroll'

    acquireBodyScrollLock()
    releaseBodyScrollLock()

    expect(document.body.style.position).toBe('relative')
    expect(document.body.style.top).toBe('12px')
    expect(document.body.style.left).toBe('4px')
    expect(document.body.style.right).toBe('8px')
    expect(document.body.style.width).toBe('90%')
    expect(document.body.style.overflow).toBe('scroll')
    expect(scrollTo).toHaveBeenCalledWith(0, 320)
  })

  it('does not decrement below zero on extra releases', () => {
    acquireBodyScrollLock()
    releaseBodyScrollLock()
    releaseBodyScrollLock()

    expect(getBodyScrollLockCountForTests()).toBe(0)
    expect(document.body.style.position).toBe('')
  })
})

describe('nested Modal and ConfirmDialog scroll lock', () => {
  beforeEach(() => {
    setupScrollY(240)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  })

  it('keeps body locked when ConfirmDialog closes above an open Modal', () => {
    const scrollTo = vi.mocked(window.scrollTo)

    const { rerender } = render(
      <>
        <Modal isOpen title="טופס" onClose={() => undefined}>
          תוכן
        </Modal>
        <ConfirmDialog
          isOpen
          title="אישור"
          message="הודעה"
          continueLabel="המשך"
          confirmLabel="סגור"
          onContinue={() => undefined}
          onConfirm={() => undefined}
        />
      </>,
    )

    expect(getBodyScrollLockCountForTests()).toBe(2)
    expect(document.body.style.position).toBe('fixed')
    scrollTo.mockClear()

    rerender(
      <>
        <Modal isOpen title="טופס" onClose={() => undefined}>
          תוכן
        </Modal>
        <ConfirmDialog
          isOpen={false}
          title="אישור"
          message="הודעה"
          continueLabel="המשך"
          confirmLabel="סגור"
          onContinue={() => undefined}
          onConfirm={() => undefined}
        />
      </>,
    )

    expect(getBodyScrollLockCountForTests()).toBe(1)
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-240px')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('restores scrolling only after the final overlay closes', () => {
    const scrollTo = vi.mocked(window.scrollTo)

    const { rerender } = render(
      <>
        <Modal isOpen title="טופס" onClose={() => undefined}>
          תוכן
        </Modal>
        <ConfirmDialog
          isOpen
          title="אישור"
          message="הודעה"
          continueLabel="המשך"
          confirmLabel="סגור"
          onContinue={() => undefined}
          onConfirm={() => undefined}
        />
      </>,
    )

    scrollTo.mockClear()

    rerender(
      <>
        <Modal isOpen title="טופס" onClose={() => undefined}>
          תוכן
        </Modal>
        <ConfirmDialog
          isOpen={false}
          title="אישור"
          message="הודעה"
          continueLabel="המשך"
          confirmLabel="סגור"
          onContinue={() => undefined}
          onConfirm={() => undefined}
        />
      </>,
    )

    rerender(
      <>
        <Modal isOpen={false} title="טופס" onClose={() => undefined}>
          תוכן
        </Modal>
        <ConfirmDialog
          isOpen={false}
          title="אישור"
          message="הודעה"
          continueLabel="המשך"
          confirmLabel="סגור"
          onContinue={() => undefined}
          onConfirm={() => undefined}
        />
      </>,
    )

    expect(getBodyScrollLockCountForTests()).toBe(0)
    expect(document.body.style.position).toBe('')
    expect(scrollTo).toHaveBeenCalledWith(0, 240)
  })

  it('supports closing overlays in reverse order without corrupting lock state', () => {
    const scrollTo = vi.mocked(window.scrollTo)

    const { rerender, unmount } = render(
      <>
        <Modal isOpen title="ראשון" onClose={() => undefined}>
          אחד
        </Modal>
        <Modal isOpen title="שני" onClose={() => undefined}>
          שני
        </Modal>
      </>,
    )

    expect(getBodyScrollLockCountForTests()).toBe(2)

    scrollTo.mockClear()

    rerender(
      <>
        <Modal isOpen={false} title="ראשון" onClose={() => undefined}>
          אחד
        </Modal>
        <Modal isOpen title="שני" onClose={() => undefined}>
          שני
        </Modal>
      </>,
    )

    expect(getBodyScrollLockCountForTests()).toBe(1)
    expect(document.body.style.position).toBe('fixed')
    expect(scrollTo).not.toHaveBeenCalled()

    scrollTo.mockClear()
    unmount()

    expect(getBodyScrollLockCountForTests()).toBe(0)
    expect(document.body.style.position).toBe('')
    expect(scrollTo).toHaveBeenCalledWith(0, 240)
  })

  it('releases locks on component unmount cleanup', () => {
    const scrollTo = vi.mocked(window.scrollTo)

    const { unmount } = render(
      <Modal isOpen title="טופס" onClose={() => undefined}>
        תוכן
      </Modal>,
    )

    expect(getBodyScrollLockCountForTests()).toBe(1)

    unmount()

    expect(getBodyScrollLockCountForTests()).toBe(0)
    expect(document.body.style.position).toBe('')
    expect(scrollTo).toHaveBeenCalledWith(0, 240)
  })

  it('does not leave a stale lock after React Strict Mode mount cycles', () => {
    render(
      <StrictMode>
        <Modal isOpen title="טופס" onClose={() => undefined}>
          תוכן
        </Modal>
      </StrictMode>,
    )

    expect(getBodyScrollLockCountForTests()).toBe(1)
    expect(document.body.style.position).toBe('fixed')
  })

  it('does not leave the page permanently locked after unrelated dialogs close', () => {
    const scrollTo = vi.mocked(window.scrollTo)

    const first = render(
      <Modal isOpen title="א" onClose={() => undefined}>
        א
      </Modal>,
    )

    first.unmount()

    const second = render(
      <ConfirmDialog
        isOpen
        title="ב"
        message="הודעה"
        continueLabel="ביטול"
        confirmLabel="אישור"
        onContinue={() => undefined}
        onConfirm={() => undefined}
      />,
    )

    second.unmount()

    expect(getBodyScrollLockCountForTests()).toBe(0)
    expect(document.body.style.position).toBe('')
    expect(scrollTo).toHaveBeenLastCalledWith(0, 240)
  })
})
