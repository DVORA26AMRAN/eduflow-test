import type { ReactNode } from 'react'
import type {
  AbsenceRequestPayload,
  BudgetOrEquipmentRequestPayload,
  RequestPayload,
  RequestType,
} from '../../types/request'
import type { RequestDetailsRequest } from '../../types/requestDetails'
import { translateAbsenceReason } from '../../utils/absence'
import {
  extractGeneralRequestMessage,
  translateRecipientRole,
} from '../../utils/generalRequestDisplay'
import {
  formatRequestDate,
  formatRequestDateTime,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'

type RequestDetailsSummaryFieldsProps = {
  request: RequestDetailsRequest
  lastUpdateAt?: string | null
}

function isAbsencePayload(payload: RequestPayload): payload is AbsenceRequestPayload {
  return 'absence_date' in payload && typeof payload.absence_date === 'string'
}

function isBudgetPayload(payload: RequestPayload): payload is BudgetOrEquipmentRequestPayload {
  return 'budget_details' in payload && typeof payload.budget_details === 'string'
}

function renderPayloadDetails(requestType: RequestType, payload?: RequestPayload): ReactNode {
  if (!payload) {
    return null
  }

  if (requestType === 'general_request') {
    const message = extractGeneralRequestMessage(payload)
    if (!message) {
      return null
    }

    return (
      <div className="request-details__details-row request-details__details-row--block">
        <dt>הודעה</dt>
        <dd className="request-details__multiline">{message}</dd>
      </div>
    )
  }

  if (requestType === 'absence' && isAbsencePayload(payload)) {
    return (
      <>
        <div className="request-details__details-row">
          <dt>תאריך היעדרות</dt>
          <dd>{formatRequestDate(payload.absence_date)}</dd>
        </div>
        <div className="request-details__details-row">
          <dt>סיבת היעדרות</dt>
          <dd>{translateAbsenceReason(payload.absence_reason)}</dd>
        </div>
        {payload.absence_reason === 'other' && payload.absence_reason_other ? (
          <div className="request-details__details-row request-details__details-row--block">
            <dt>פירוט סיבה</dt>
            <dd className="request-details__multiline">{payload.absence_reason_other}</dd>
          </div>
        ) : null}
        {payload.replaced_by ? (
          <div className="request-details__details-row">
            <dt>מי מחליף</dt>
            <dd>{payload.replaced_by}</dd>
          </div>
        ) : null}
      </>
    )
  }

  if (requestType === 'budget_or_equipment' && isBudgetPayload(payload)) {
    return (
      <>
        <div className="request-details__details-row request-details__details-row--block">
          <dt>פירוט הבקשה</dt>
          <dd className="request-details__multiline">{payload.budget_details}</dd>
        </div>
        {payload.requested_amount !== null ? (
          <div className="request-details__details-row">
            <dt>סכום מבוקש</dt>
            <dd>{payload.requested_amount} ש&quot;ח</dd>
          </div>
        ) : null}
        {payload.bank_account_details ? (
          <div className="request-details__details-row request-details__details-row--block">
            <dt>פרטי חשבון בנק</dt>
            <dd className="request-details__multiline">{payload.bank_account_details}</dd>
          </div>
        ) : null}
      </>
    )
  }

  return null
}

export function RequestDetailsSummaryFields({
  request,
  lastUpdateAt = null,
}: RequestDetailsSummaryFieldsProps) {
  const teacherName =
    request.role === 'secretary' || request.role === 'manager'
      ? request.teacher_full_name
      : null

  const subjectLabel = request.request_type === 'general_request' ? 'נושא' : 'תיאור'

  return (
    <dl className="request-details__summary">
      {teacherName ? (
        <div className="request-details__details-row">
          <dt>שם מורה</dt>
          <dd>{teacherName}</dd>
        </div>
      ) : null}

      <div className="request-details__details-row">
        <dt>סוג בקשה</dt>
        <dd>{translateRequestType(request.request_type)}</dd>
      </div>

      {request.role === 'teacher' &&
      request.request_type === 'general_request' &&
      request.recipient_role ? (
        <div className="request-details__details-row">
          <dt>נמען</dt>
          <dd>{translateRecipientRole(request.recipient_role)}</dd>
        </div>
      ) : null}

      <div className="request-details__details-row">
        <dt>סטטוס</dt>
        <dd>
          <span className={`ds-table__status ds-table__status--${request.status}`}>
            {translateRequestStatus(request.status)}
          </span>
        </dd>
      </div>

      <div className="request-details__details-row">
        <dt>תאריך יצירה</dt>
        <dd>{formatRequestDate(request.created_at)}</dd>
      </div>

      {lastUpdateAt ? (
        <div className="request-details__details-row">
          <dt>עדכון אחרון</dt>
          <dd>{formatRequestDateTime(lastUpdateAt)}</dd>
        </div>
      ) : null}

      <div className="request-details__details-row request-details__details-row--block">
        <dt>{subjectLabel}</dt>
        <dd className="request-details__multiline">{request.description}</dd>
      </div>

      {renderPayloadDetails(request.request_type, request.request_payload)}
    </dl>
  )
}
