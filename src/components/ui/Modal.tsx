import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../../utils/bodyScrollLock'
import './Modal.css'

export type ModalSize = 'small' | 'medium' | 'large' | 'auto'

type ModalProps = {
  isOpen: boolean
  title: string
  children: ReactNode
  onClose: () => void
  closeLabel?: string
  size?: ModalSize
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

function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

function getPageDirection(): 'rtl' | 'ltr' {
  const dir = document.querySelector<HTMLElement>('#root [dir]')?.getAttribute('dir')
  return dir === 'ltr' ? 'ltr' : 'rtl'
}

function getModalSizeClassName(size: ModalSize): string {
  return `ds-modal--${size}`
}

export function Modal({
  isOpen,
  title,
  children,
  onClose,
  closeLabel = 'סגירת חלון',
  size = 'medium',
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
          className={`ds-modal ${getModalSizeClassName(size)}`}
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
  closeOnBackdropClick?: boolean
  continueDisabled?: boolean
  confirmDisabled?: boolean
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  continueLabel,
  confirmLabel,
  onContinue,
  onConfirm,
  closeOnBackdropClick = false,
  continueDisabled = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
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
        if (!continueDisabled) {
          onContinue()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onContinue, continueDisabled])

  if (!isOpen) {
    return null
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (!closeOnBackdropClick || continueDisabled || confirmDisabled) {
      return
    }

    if (event.target === event.currentTarget) {
      onContinue()
    }
  }

  return (
    <ModalPortal>
      <div
        className="ds-modal-overlay ds-modal-overlay--confirm"
        dir={pageDirection}
        onClick={handleBackdropClick}
        role="presentation"
      >
        <div
          ref={panelRef}
          className="ds-modal ds-modal--small ds-modal--confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="ds-modal__header ds-modal__header--confirm">
            <h3 id={titleId} className="ds-modal__title">
              {title}
            </h3>
          </div>
          <div className="ds-modal__body ds-modal__body--confirm">
            <p className="ds-form-message">{message}</p>
            <div className="ds-modal__confirm-actions">
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                onClick={onContinue}
                disabled={continueDisabled}
              >
                {continueLabel}
              </button>
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={onConfirm}
                disabled={confirmDisabled}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
