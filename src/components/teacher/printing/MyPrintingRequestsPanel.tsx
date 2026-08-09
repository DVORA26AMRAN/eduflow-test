import { useCallback, useEffect, useState } from 'react'
import type { PrintingRequestStatus, PrintItemStatus } from '../../../types/printing'
import {
  cancelPrintingRequest,
  getAuthorizedPrintingRequest,
  listMyPrintingRequests,
  type PrintingRequestListRow,
} from '../../../services/printingRequests'
import {
  formatPrintingRequestNumber,
  formatRequiredByDisplay,
  isPrintingRequestEditable,
  mapPrintingErrorCode,
  translatePrintItemStatus,
  translatePrintingRequestStatus,
} from '../../../utils/printingUi'
import { ConfirmDialog } from '../../ui/Modal'
import { Modal } from '../../ui/Modal'
import {
  TeacherPrintItemCorrectionModal,
  type CorrectionItemSource,
} from './TeacherPrintItemCorrectionModal'

type MyPrintingRequestsPanelProps = {
  teacherUserId: string
  institutionTimeZone: string
  refreshToken: number
  onEditRequest: (requestId: string) => void
  onCreateNew: () => void
  focusRequestId?: string | null
}

export function MyPrintingRequestsPanel({
  teacherUserId,
  institutionTimeZone,
  refreshToken,
  onEditRequest,
  onCreateNew,
  focusRequestId = null,
}: MyPrintingRequestsPanelProps) {
  const [requests, setRequests] = useState<PrintingRequestListRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [details, setDetails] = useState<PrintingRequestListRow | null>(null)
  const [detailsItems, setDetailsItems] = useState<
    Array<{
      id: string
      original_filename: string
      status: string
      notes: string | null
      copies: number
      color_mode: string
      paper_size: string
      sides: string
      duplex_flip_mode: string | null
      page_selection_mode: string
      page_selection_value: string | null
      storage_object_path: string | null
      correction_reason: string | null
      rejection_reason: string | null
      detected_file_type: string
      file_size_bytes: number
      orientation: string
      pages_per_sheet: number
      scale_mode: string
      custom_scale_percent: number | null
      collate: boolean
      file_purged_at: string | null
    }>
  >([])
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<PrintingRequestListRow | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [correctionItem, setCorrectionItem] = useState<CorrectionItemSource | null>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    const result = await listMyPrintingRequests()
    if (!result.ok) {
      setRequests([])
      setLoadError(result.errorMessage)
    } else {
      setRequests(result.requests)
    }
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, refreshToken])

  useEffect(() => {
    if (!focusRequestId || requests.length === 0) return
    const row = requests.find((r) => r.id === focusRequestId)
    if (row) void openDetails(row)
  }, [focusRequestId, requests])

  async function openDetails(row: PrintingRequestListRow) {
    setDetails(row)
    setDetailsLoading(true)
    setActionMessage('')
    const { data, error } = await getAuthorizedPrintingRequest(row.id)
    if (error || !data) {
      setDetailsItems([])
      setDetailsLoading(false)
      setActionMessage('טעינת פרטי הבקשה נכשלה.')
      return
    }
    const items = Array.isArray(data.print_items) ? data.print_items : []
    setDetailsItems(
      [...items].sort(
        (a: { display_order?: number }, b: { display_order?: number }) =>
          (a.display_order ?? 0) - (b.display_order ?? 0),
      ) as typeof detailsItems,
    )
    setDetailsLoading(false)
  }

  async function confirmCancel() {
    if (!cancelTarget || isCancelling) return
    setIsCancelling(true)
    const result = await cancelPrintingRequest(cancelTarget.id)
    setIsCancelling(false)
    setCancelTarget(null)
    if (!result.ok) {
      setActionMessage(mapPrintingErrorCode(result.error_code))
      return
    }
    setActionMessage('בקשת ההדפסה בוטלה.')
    setDetails(null)
    void reload()
  }

  if (isLoading) {
    return <p className="ds-state" role="status">טוען בקשות הדפסה…</p>
  }

  if (loadError) {
    return <p className="ds-form-message ds-form-message--error">{loadError}</p>
  }

  if (requests.length === 0) {
    return (
      <div className="printing-empty">
        <p className="ds-state">עדיין לא שלחת בקשות הדפסה.</p>
        <button type="button" className="ds-btn ds-btn--primary" onClick={onCreateNew}>
          בקשת הדפסה חדשה
        </button>
      </div>
    )
  }

  return (
    <div className="printing-my-requests">
      {actionMessage ? (
        <p className="ds-form-message" role="status">
          {actionMessage}
        </p>
      ) : null}
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead>
            <tr>
              <th scope="col">מספר</th>
              <th scope="col">נדרש ל־</th>
              <th scope="col">קבצים</th>
              <th scope="col">נשלח</th>
              <th scope="col">עודכן</th>
              <th scope="col">סטטוס</th>
              <th scope="col">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((row) => {
              const status = row.status as PrintingRequestStatus
              const required = formatRequiredByDisplay(row.required_by, institutionTimeZone)
              const editable = isPrintingRequestEditable({
                teacherUserId,
                actorUserId: teacherUserId,
                assignedSecretaryUserId: row.assigned_secretary_user_id,
                processingStartedAt: row.processing_started_at,
                status,
              })
              return (
                <tr key={row.id}>
                  <td>{formatPrintingRequestNumber(row.request_number)}</td>
                  <td>
                    {required.date} {required.time}
                  </td>
                  <td>{row.print_items?.length ?? 0}</td>
                  <td>{new Date(row.submitted_at).toLocaleString('he-IL')}</td>
                  <td>{new Date(row.updated_at).toLocaleString('he-IL')}</td>
                  <td>
                    <span className={`ds-table__status ds-table__status--${status}`}>
                      {translatePrintingRequestStatus(status)}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ds-btn ds-btn--secondary"
                      onClick={() => void openDetails(row)}
                    >
                      פרטים
                    </button>
                    {editable ? (
                      <>
                        <button
                          type="button"
                          className="ds-btn ds-btn--secondary"
                          onClick={() => onEditRequest(row.id)}
                        >
                          עריכה
                        </button>
                        <button
                          type="button"
                          className="ds-btn ds-btn--secondary"
                          onClick={() => setCancelTarget(row)}
                        >
                          ביטול
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={details != null}
        title={
          details
            ? `בקשת הדפסה ${formatPrintingRequestNumber(details.request_number)}`
            : 'פרטי בקשה'
        }
        onClose={() => setDetails(null)}
        size="large"
      >
        {details ? (
          <div className="printing-details">
            {detailsLoading ? <p role="status">טוען…</p> : null}
            <p>
              סטטוס:{' '}
              <strong>
                {translatePrintingRequestStatus(details.status as PrintingRequestStatus)}
              </strong>
            </p>
            {!isPrintingRequestEditable({
              teacherUserId,
              actorUserId: teacherUserId,
              assignedSecretaryUserId: details.assigned_secretary_user_id,
              processingStartedAt: details.processing_started_at,
              status: details.status as PrintingRequestStatus,
            }) &&
            details.status !== 'cancelled' &&
            details.status !== 'printed' &&
            details.status !== 'needs_correction' ? (
              <p className="ds-form-message ds-form-message--warning">
                הטיפול בבקשה כבר התחיל ולכן לא ניתן לערוך אותה.
              </p>
            ) : null}
            {details.status === 'needs_correction' ? (
              <p className="ds-form-message ds-form-message--warning" role="status">
                יש קובץ אחד או יותר שדורש תיקון. ניתן לתקן רק את הקבצים שהוחזרו.
              </p>
            ) : null}
            {details.files_purged_at ? (
              <p className="ds-form-message">הקובץ אינו נשמר עוד במערכת.</p>
            ) : null}
            <ul className="printing-details__items">
              {detailsItems.map((item) => (
                <li key={item.id}>
                  <strong>{item.original_filename}</strong>
                  {' — '}
                  <span className={`ds-table__status ds-table__status--${item.status}`}>
                    {translatePrintItemStatus(item.status as PrintItemStatus)}
                  </span>
                  <div className="printing-details__settings">
                    {item.copies} עותקים · {item.paper_size.toUpperCase()} ·{' '}
                    {item.color_mode === 'color' ? 'צבעוני' : 'שחור־לבן'} ·{' '}
                    {item.sides === 'double_sided' ? 'דו־צדדי' : 'חד־צדדי'}
                    {item.page_selection_mode === 'custom'
                      ? ` · עמודים ${item.page_selection_value}`
                      : ' · כל העמודים'}
                    {item.notes ? ` · ${item.notes}` : ''}
                  </div>
                  {item.correction_reason ? (
                    <p className="ds-form-message ds-form-message--warning">
                      סיבת תיקון: {item.correction_reason}
                    </p>
                  ) : null}
                  {item.rejection_reason ? (
                    <p className="ds-form-message ds-form-message--error">
                      סיבת דחייה: {item.rejection_reason}
                    </p>
                  ) : null}
                  {item.file_purged_at || (!item.storage_object_path && details.files_purged_at) ? (
                    <p className="ds-form-message">הקובץ אינו נשמר עוד במערכת.</p>
                  ) : null}
                  {item.status === 'returned_for_correction' ? (
                    <button
                      type="button"
                      className="ds-btn ds-btn--primary"
                      onClick={() =>
                        setCorrectionItem({
                          id: item.id,
                          printingRequestId: details.id,
                          institutionId: details.institution_id,
                          original_filename: item.original_filename,
                          detected_file_type: item.detected_file_type,
                          file_size_bytes: item.file_size_bytes,
                          storage_object_path: item.storage_object_path,
                          page_selection_mode: item.page_selection_mode,
                          page_selection_value: item.page_selection_value,
                          copies: item.copies,
                          color_mode: item.color_mode,
                          paper_size: item.paper_size,
                          orientation: item.orientation,
                          sides: item.sides,
                          duplex_flip_mode: item.duplex_flip_mode,
                          pages_per_sheet: item.pages_per_sheet,
                          scale_mode: item.scale_mode,
                          custom_scale_percent: item.custom_scale_percent,
                          collate: item.collate,
                          notes: item.notes,
                          correction_reason: item.correction_reason,
                        })
                      }
                    >
                      תיקון קובץ
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>

      <TeacherPrintItemCorrectionModal
        isOpen={correctionItem != null}
        item={correctionItem}
        onClose={() => setCorrectionItem(null)}
        onResubmitted={() => {
          setActionMessage('הקובץ נשלח מחדש.')
          if (details) void openDetails(details)
          void reload()
        }}
      />

      <ConfirmDialog
        isOpen={cancelTarget != null}
        title="ביטול בקשת הדפסה"
        message="האם לבטל את בקשת ההדפסה? לאחר תחילת הטיפול לא ניתן לבטל."
        continueLabel="המשך"
        confirmLabel="בטל בקשה"
        onContinue={() => {
          if (!isCancelling) setCancelTarget(null)
        }}
        onConfirm={() => void confirmCancel()}
      />
    </div>
  )
}
