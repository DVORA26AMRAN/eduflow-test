import { useState } from 'react'
import {
  canShowClaimAction,
  type EligibleHandlerRole,
} from '../../domain/requestOwnership'
import type { GeneralRequestRecipientRole, RequestStatus, RequestType } from '../../types/request'
import type { PrimaryRole } from '../../types/user'
import { translateRole } from '../../utils/roles'
import { RequestHandlerAssignmentDialog } from './RequestHandlerAssignmentDialog'
import './RequestHandlerControls.css'

export type RequestHandlerView = {
  id: string
  request_type: RequestType
  status: RequestStatus
  handled_by_user_id: string | null
  handled_by_full_name: string | null
  handled_by_primary_role: EligibleHandlerRole | null
  recipient_role: GeneralRequestRecipientRole | null
}

type RequestHandlerCellProps = {
  request: RequestHandlerView
  actorUserId: string
  actorRole: PrimaryRole
  institutionId?: string | null
  isBusy: boolean
  onClaim: (requestId: string) => void
  onAssigned: (patch: {
    requestId: string
    handledByUserId: string
    handledByFullName: string
    handledByPrimaryRole: EligibleHandlerRole
    status: RequestStatus
  }) => void
  onReleased: (requestId: string, status: RequestStatus) => void
  onError: (message: string, errorCode?: string) => void
}

export function RequestHandlerCell({
  request,
  actorUserId,
  actorRole,
  institutionId = null,
  isBusy,
  onClaim,
  onAssigned,
  onReleased,
  onError,
}: RequestHandlerCellProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const canClaim = canShowClaimAction({
    actorRole,
    handledByUserId: request.handled_by_user_id,
    status: request.status,
    requestType: request.request_type,
    recipientRole: request.recipient_role,
  })

  const handlerName = request.handled_by_full_name?.trim() || null
  const handlerRoleLabel = request.handled_by_primary_role
    ? translateRole(request.handled_by_primary_role)
    : null
  const assignedName = handlerName ?? 'מטפלת'

  return (
    <div className="request-handler">
      {request.handled_by_user_id ? (
        <>
          <button
            type="button"
            className="request-handler__assigned"
            onClick={(event) => {
              event.stopPropagation()
              setIsDialogOpen(true)
            }}
            aria-label={`בטיפול של ${assignedName}${handlerRoleLabel ? ` · ${handlerRoleLabel}` : ''}`}
          >
            <span className="request-handler__label">בטיפול של</span>
            <span className="request-handler__name">
              {assignedName}
              {handlerRoleLabel ? ` · ${handlerRoleLabel}` : ''}
            </span>
          </button>
          <RequestHandlerAssignmentDialog
            isOpen={isDialogOpen}
            requestId={request.id}
            requestType={request.request_type}
            recipientRole={request.recipient_role}
            status={request.status}
            handledByUserId={request.handled_by_user_id}
            handledByFullName={assignedName}
            handledByPrimaryRole={request.handled_by_primary_role}
            actorUserId={actorUserId}
            actorRole={actorRole}
            institutionId={institutionId}
            isBusy={isBusy}
            onClose={() => setIsDialogOpen(false)}
            onTransferred={(input) => {
              setIsDialogOpen(false)
              onAssigned({
                requestId: request.id,
                handledByUserId: input.handledByUserId,
                handledByFullName: input.handledByFullName,
                handledByPrimaryRole: input.handledByPrimaryRole,
                status: input.status,
              })
            }}
            onReleased={(nextStatus) => {
              setIsDialogOpen(false)
              onReleased(request.id, nextStatus)
            }}
            onError={onError}
          />
        </>
      ) : (
        <div className="request-handler__unassigned">
          <span className="request-handler__label">בטיפול של</span>
          <span className="request-handler__empty">לא הוקצתה מטפלת</span>
          {canClaim ? (
            <button
              type="button"
              className="ds-btn ds-btn--secondary request-handler__claim"
              onClick={(event) => {
                event.stopPropagation()
                onClaim(request.id)
              }}
              disabled={isBusy}
            >
              לקחת לטיפול
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
