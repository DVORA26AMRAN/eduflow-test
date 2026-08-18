import { useEffect, useRef, useState } from 'react'
import {
  canManageCurrentAssignment,
  canShowReleaseAction,
} from '../../domain/requestOwnership'
import {
  loadEligibleRequestHandlers,
  releaseRequestHandler,
  transferRequestHandler,
} from '../../services/requestOwnership'
import type { EligibleHandlerRole } from '../../domain/requestOwnership'
import type { GeneralRequestRecipientRole, RequestStatus, RequestType } from '../../types/request'
import type { RequestHandlerOption } from '../../types/requestOwnership'
import type { PrimaryRole } from '../../types/user'
import { translateRole } from '../../utils/roles'
import { Modal } from '../ui/Modal'

type RequestHandlerAssignmentDialogProps = {
  isOpen: boolean
  requestId: string
  requestType: RequestType
  recipientRole: GeneralRequestRecipientRole | null
  status: RequestStatus
  handledByUserId: string
  handledByFullName: string
  handledByPrimaryRole: EligibleHandlerRole | null
  actorUserId: string
  actorRole: PrimaryRole
  institutionId?: string | null
  isBusy: boolean
  onClose: () => void
  onTransferred: (input: {
    handledByUserId: string
    handledByFullName: string
    handledByPrimaryRole: EligibleHandlerRole
    status: RequestStatus
  }) => void
  onReleased: (status: RequestStatus) => void
  onError: (message: string, errorCode?: string) => void
}

export function RequestHandlerAssignmentDialog({
  isOpen,
  requestId,
  requestType,
  recipientRole,
  status,
  handledByUserId,
  handledByFullName,
  handledByPrimaryRole,
  actorUserId,
  actorRole,
  institutionId = null,
  isBusy,
  onClose,
  onTransferred,
  onReleased,
  onError,
}: RequestHandlerAssignmentDialogProps) {
  const [handlers, setHandlers] = useState<RequestHandlerOption[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [isLoadingHandlers, setIsLoadingHandlers] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const onErrorRef = useRef(onError)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const canManage = canManageCurrentAssignment({
    actorRole,
    actorUserId,
    handledByUserId,
  })
  const canRelease = canShowReleaseAction({
    actorRole,
    actorUserId,
    handledByUserId,
    status,
  })

  useEffect(() => {
    if (!isOpen || !canManage) {
      return
    }

    let cancelled = false

    queueMicrotask(() => {
      void (async () => {
        setIsLoadingHandlers(true)
        const result = await loadEligibleRequestHandlers({
          requestType,
          recipientRole,
          excludeUserId: handledByUserId,
          institutionId,
        })
        if (cancelled) {
          return
        }

        setIsLoadingHandlers(false)
        if (!result.ok) {
          setHandlers([])
          onErrorRef.current(result.errorMessage)
          return
        }

        setHandlers(result.handlers)
        setSelectedUserId(result.handlers[0]?.id ?? '')
      })()
    })

    return () => {
      cancelled = true
    }
  }, [canManage, handledByUserId, institutionId, isOpen, recipientRole, requestType])

  async function handleTransfer() {
    if (!canManage || !selectedUserId || isSaving || isBusy) {
      return
    }

    const target = handlers.find((handler) => handler.id === selectedUserId)
    if (!target) {
      return
    }

    setIsSaving(true)
    const result = await transferRequestHandler(requestId, selectedUserId)
    setIsSaving(false)

    if (!result.ok) {
      onError(result.errorMessage, result.errorCode)
      return
    }

    onTransferred({
      handledByUserId: result.handledByUserId,
      handledByFullName: target.fullName,
      handledByPrimaryRole: target.primaryRole,
      status: result.status,
    })
  }

  async function handleRelease() {
    if (!canRelease || isSaving || isBusy) {
      return
    }

    setIsSaving(true)
    const result = await releaseRequestHandler(requestId)
    setIsSaving(false)

    if (!result.ok) {
      onError(result.errorMessage, result.errorCode)
      return
    }

    onReleased(result.status)
  }

  const handlerRoleLabel = handledByPrimaryRole ? translateRole(handledByPrimaryRole) : null

  return (
    <Modal isOpen={isOpen} title="טיפול בבקשה" size="small" onClose={onClose}>
      <div className="request-handler-dialog">
        <p className="request-handler-dialog__current">
          בטיפול של {handledByFullName}
          {handlerRoleLabel ? ` · ${handlerRoleLabel}` : ''}
        </p>

        {canManage ? (
          <>
            <label className="ds-field" htmlFor={`request-handler-transfer-${requestId}`}>
              <span className="ds-label">העברה לטיפול</span>
              <select
                id={`request-handler-transfer-${requestId}`}
                className="ds-input"
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                disabled={isLoadingHandlers || isSaving || isBusy || handlers.length === 0}
              >
                {handlers.length === 0 ? (
                  <option value="">אין מטפלות זמינות</option>
                ) : (
                  handlers.map((handler) => (
                    <option key={handler.id} value={handler.id}>
                      {handler.fullName} · {translateRole(handler.primaryRole)}
                    </option>
                  ))
                )}
              </select>
            </label>

            <div className="request-handler-dialog__actions">
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={() => void handleTransfer()}
                disabled={!selectedUserId || isSaving || isBusy || isLoadingHandlers}
              >
                {isSaving ? 'מעדכן...' : 'העברה לטיפול'}
              </button>
              {canRelease ? (
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => void handleRelease()}
                  disabled={isSaving || isBusy}
                >
                  שחרור טיפול
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="ds-form-message">רק המטפלת הנוכחית או המנהלת יכולות להעביר או לשחרר טיפול.</p>
        )}
      </div>
    </Modal>
  )
}
