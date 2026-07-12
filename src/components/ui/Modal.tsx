import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import './Modal.css'

type ModalProps = {
  isOpen: boolean
  title: string
  children: ReactNode
  onClose: () => void
  closeLabel?: string
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  )
}

function useFocusTrap(containerRef: RefObject<HTMLElement | null>, isActive: boolean) {
  useEffect(() => {
    if (!isActive || !containerRef.current) {
      return
    }

    const container = containerRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusableElements = getFocusableElements(container)
    focusableElements[0]?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') {
        return
      }

      const elements = getFocusableElements(container)
      if (elements.length === 0) {
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
        return
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [containerRef, isActive])
}

function useBodyScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isLocked])
}

function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

function getPageDirection(): 'rtl' | 'ltr' {
  const dir = document.querySelector<HTMLElement>('#root [dir]')?.getAttribute('dir')
  return dir === 'ltr' ? 'ltr' : 'rtl'
}

export function Modal({
  isOpen,
  title,
  children,
  onClose,
  closeLabel = 'סגירת חלון',
}: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const pageDirection = getPageDirection()

  useFocusTrap(panelRef, isOpen)
  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <ModalPortal>
      <div
        className="ds-modal-overlay"
        dir={pageDirection}
        onClick={handleBackdropClick}
        role="presentation"
      >
        <div
          ref={panelRef}
          className="ds-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="ds-modal__header">
            <h2 id={titleId} className="ds-modal__title">
              {title}
            </h2>
            <button
              type="button"
              className="ds-modal__close-button"
              onClick={onClose}
              aria-label={closeLabel}
            >
              ×
            </button>
          </div>
          <div className="ds-modal__body">{children}</div>
        </div>
      </div>
    </ModalPortal>
  )
}

type ConfirmDialogProps = {
  isOpen: boolean
  title: string
  message: string
  continueLabel: string
  confirmLabel: string
  onContinue: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  continueLabel,
  confirmLabel,
  onContinue,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const pageDirection = getPageDirection()

  useFocusTrap(panelRef, isOpen)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onContinue()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onContinue])

  if (!isOpen) {
    return null
  }

  return (
    <ModalPortal>
      <div className="ds-modal__confirm-overlay" dir={pageDirection} role="presentation">
        <div
          ref={panelRef}
          className="ds-modal__confirm-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <h3 id={titleId} className="ds-modal__title">
            {title}
          </h3>
          <p className="ds-form-message">{message}</p>
          <div className="ds-modal__confirm-actions">
            <button type="button" className="ds-btn ds-btn--secondary" onClick={onContinue}>
              {continueLabel}
            </button>
            <button type="button" className="ds-btn ds-btn--primary" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
