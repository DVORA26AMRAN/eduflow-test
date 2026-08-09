import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DashboardSection } from '../../dashboard/DashboardSection'
import { NavPrintIcon } from '../../dashboard/dashboardNav'
import { ConfirmDialog, Modal } from '../../ui/Modal'
import {
  accessPrintingFile,
  claimPrintingRequest,
  listInstitutionPrintingRequests,
  listInstitutionSecretariesForTransfer,
  loadInstitutionPrintingSettings,
  markPrintItemPrinted,
  rejectPrintItem,
  releasePrintingRequest,
  returnPrintItemForCorrection,
  transferPrintingRequest,
  type InstitutionPrintingRequestRow,
  type InstitutionSecretaryOption,
} from '../../../services/printingRequests'
import { triggerAttachmentDownload } from '../../../utils/attachmentDownload'
import {
  formatBytes,
  formatPrintingRequestNumber,
  formatRequiredByDisplay,
  isPreviewablePrintFile,
  mapPrintingErrorCode,
  translatePrintItemStatus,
  translatePrintingRequestStatus,
} from '../../../utils/printingUi'
import {
  DEADLINE_GROUP_LABELS,
  DEFAULT_SECRETARY_PRINTING_FILTERS,
  describePrintingQueueRow,
  filterSecretaryPrintingRequests,
  formatPrintItemSettingsHebrew,
  groupActivePrintingRequests,
  HISTORY_PRINTING_STATUSES,
  isApproachingPrintingDeadline,
  wasUpdatedAfterSubmission,
  type PrintingDeadlineGroup,
  type PrintingWorkspaceView,
  type SecretaryPrintingFilters,
} from '../../../utils/secretaryPrinting'
import { isPrintingRequestOverdue } from '../../../domain/printing/validation'
import type { PrintItemStatus, PrintingRequestStatus } from '../../../types/printing'
import './secretaryPrinting.css'

type SecretaryPrintingWorkspaceProps = {
  actorUserId: string
  institutionId: string
  institutionTimeZone: string
  focusRequestId?: string | null
  onFocusRequestConsumed?: () => void
}

type ItemActionKind = 'print_mark' | 'return' | 'reject'

export function SecretaryPrintingWorkspace({
  actorUserId,
  institutionId,
  institutionTimeZone,
  focusRequestId = null,
  onFocusRequestConsumed,
}: SecretaryPrintingWorkspaceProps) {
  const [view, setView] = useState<PrintingWorkspaceView>('active')
  const [filters, setFilters] = useState<SecretaryPrintingFilters>(DEFAULT_SECRETARY_PRINTING_FILTERS)
  const [requests, setRequests] = useState<InstitutionPrintingRequestRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [actionIsError, setActionIsError] = useState(false)
  const [deadlineWarningMinutes, setDeadlineWarningMinutes] = useState(120)
  const [timeZone, setTimeZone] = useState(institutionTimeZone || 'UTC')
  const [details, setDetails] = useState<InstitutionPrintingRequestRow | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [secretaries, setSecretaries] = useState<InstitutionSecretaryOption[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = useState('')

  const [releaseConfirm, setReleaseConfirm] = useState(false)
  const [transferTargetId, setTransferTargetId] = useState('')
  const [transferConfirm, setTransferConfirm] = useState(false)
  const [itemAction, setItemAction] = useState<{
    kind: ItemActionKind
    itemId: string
    filename: string
  } | null>(null)
  const [itemReason, setItemReason] = useState('')
  const consumedFocusRequestIdRef = useRef<string | null>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    const [listResult, settingsResult] = await Promise.all([
      listInstitutionPrintingRequests(),
      loadInstitutionPrintingSettings(institutionId),
    ])

    if (!listResult.ok) {
      setRequests([])
      setLoadError(listResult.errorMessage)
    } else {
      setRequests(listResult.requests)
    }

    if (settingsResult.ok) {
      setDeadlineWarningMinutes(settingsResult.deadlineWarningMinutes)
      setTimeZone(settingsResult.timeZone || institutionTimeZone || 'UTC')
    }

    setIsLoading(false)
  }, [institutionId, institutionTimeZone])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let cancelled = false
    void listInstitutionSecretariesForTransfer().then((result) => {
      if (cancelled) return
      if (result.ok) setSecretaries(result.secretaries)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () =>
      filterSecretaryPrintingRequests({
        requests,
        view,
        filters,
        timeZone,
        deadlineWarningMinutes,
      }),
    [requests, view, filters, timeZone, deadlineWarningMinutes],
  )

  const grouped = useMemo(
    () => groupActivePrintingRequests({ requests: filtered, timeZone }),
    [filtered, timeZone],
  )

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of requests) {
      if (row.assigned_secretary_user_id && row.assigned_secretary_full_name) {
        map.set(row.assigned_secretary_user_id, row.assigned_secretary_full_name)
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [requests])

  function patchFilters(patch: Partial<SecretaryPrintingFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  function showFeedback(message: string, isError: boolean) {
    setActionMessage(message)
    setActionIsError(isError)
  }

  async function openDetails(row: InstitutionPrintingRequestRow) {
    // Opening must not claim — show queue row immediately, then soft-refresh.
    setDetails(row)
    setActionMessage('')
    setDetailsLoading(true)
    const listResult = await listInstitutionPrintingRequests()
    if (listResult.ok) {
      setRequests(listResult.requests)
      const fresh = listResult.requests.find((r) => r.id === row.id)
      if (fresh) setDetails(fresh)
    }
    setDetailsLoading(false)
  }

  useEffect(() => {
    if (!focusRequestId) {
      consumedFocusRequestIdRef.current = null
      return
    }
    if (isLoading) return
    if (consumedFocusRequestIdRef.current === focusRequestId) return

    const row = requests.find((request) => request.id === focusRequestId)
    if (!row) {
      consumedFocusRequestIdRef.current = focusRequestId
      onFocusRequestConsumed?.()
      return
    }

    consumedFocusRequestIdRef.current = focusRequestId
    setView(
      HISTORY_PRINTING_STATUSES.includes(row.status as (typeof HISTORY_PRINTING_STATUSES)[number])
        ? 'history'
        : 'active',
    )
    void openDetails(row).finally(() => {
      onFocusRequestConsumed?.()
    })
  }, [focusRequestId, isLoading, onFocusRequestConsumed, requests])

  function refreshDetailsFromList(next: InstitutionPrintingRequestRow[]) {
    setRequests(next)
    if (details) {
      setDetails(next.find((r) => r.id === details.id) ?? null)
    }
  }

  async function handleClaim() {
    if (!details || busyAction) return
    setBusyAction('claim')
    const result = await claimPrintingRequest(details.id)
    setBusyAction(null)
    if (!result.ok) {
      showFeedback(mapPrintingErrorCode(result.error_code), true)
      void reload().then(() => {
        /* keep filters */
      })
      const refreshed = await listInstitutionPrintingRequests()
      if (refreshed.ok) refreshDetailsFromList(refreshed.requests)
      return
    }
    showFeedback('הבקשה נלקחה לטיפול.', false)
    const refreshed = await listInstitutionPrintingRequests()
    if (refreshed.ok) refreshDetailsFromList(refreshed.requests)
  }

  async function handleRelease() {
    if (!details || busyAction) return
    setBusyAction('release')
    const result = await releasePrintingRequest(details.id)
    setBusyAction(null)
    setReleaseConfirm(false)
    if (!result.ok) {
      showFeedback(mapPrintingErrorCode(result.error_code), true)
      const refreshed = await listInstitutionPrintingRequests()
      if (refreshed.ok) refreshDetailsFromList(refreshed.requests)
      return
    }
    showFeedback('הבקשה שוחררה לתור המשותף.', false)
    const refreshed = await listInstitutionPrintingRequests()
    if (refreshed.ok) refreshDetailsFromList(refreshed.requests)
  }

  async function handleTransfer() {
    if (!details || !transferTargetId || busyAction) return
    setBusyAction('transfer')
    const result = await transferPrintingRequest({
      printingRequestId: details.id,
      targetSecretaryUserId: transferTargetId,
    })
    setBusyAction(null)
    setTransferConfirm(false)
    if (!result.ok) {
      showFeedback(mapPrintingErrorCode(result.error_code), true)
      const refreshed = await listInstitutionPrintingRequests()
      if (refreshed.ok) refreshDetailsFromList(refreshed.requests)
      return
    }
    showFeedback('הבקשה הועברה בהצלחה.', false)
    setTransferTargetId('')
    const refreshed = await listInstitutionPrintingRequests()
    if (refreshed.ok) refreshDetailsFromList(refreshed.requests)
  }

  async function runItemAction() {
    if (!itemAction || busyAction) return
    if (
      (itemAction.kind === 'return' || itemAction.kind === 'reject') &&
      !itemReason.trim()
    ) {
      showFeedback('יש למלא סיבה.', true)
      return
    }
    setBusyAction(itemAction.kind)
    const kind = itemAction.kind
    let result
    if (kind === 'print_mark') {
      result = await markPrintItemPrinted(itemAction.itemId)
    } else if (kind === 'return') {
      result = await returnPrintItemForCorrection({
        printItemId: itemAction.itemId,
        reason: itemReason.trim(),
      })
    } else {
      result = await rejectPrintItem({
        printItemId: itemAction.itemId,
        reason: itemReason.trim(),
      })
    }
    setBusyAction(null)
    setItemAction(null)
    setItemReason('')
    if (!result.ok) {
      showFeedback(mapPrintingErrorCode(result.error_code), true)
      const refreshed = await listInstitutionPrintingRequests()
      if (refreshed.ok) refreshDetailsFromList(refreshed.requests)
      return
    }
    showFeedback(
      kind === 'print_mark'
        ? 'הפריט סומן כהודפס.'
        : kind === 'return'
          ? 'הפריט הוחזר לתיקון.'
          : 'הפריט נדחה.',
      false,
    )
    const refreshed = await listInstitutionPrintingRequests()
    if (refreshed.ok) {
      refreshDetailsFromList(refreshed.requests)
      if (result.ok && 'request_status' in result && result.request_status === 'printed') {
        setView('history')
      }
    }
  }

  async function handleFileAction(
    kind: 'open' | 'download' | 'print',
    item: NonNullable<InstitutionPrintingRequestRow['print_items']>[number],
  ) {
    if (!details || busyAction) return
    setBusyAction(`file-${kind}-${item.id}`)
    const access = await accessPrintingFile({
      storageObjectPath: item.storage_object_path,
      filesPurgedAt: details.files_purged_at,
      itemFilePurgedAt: item.file_purged_at,
    })
    setBusyAction(null)
    if (!access.ok) {
      showFeedback(access.errorMessage, true)
      return
    }

    if (kind === 'download') {
      const dl = await triggerAttachmentDownload(access.signedUrl, item.original_filename)
      if (!dl.ok) showFeedback(dl.errorMessage, true)
      return
    }

    if (kind === 'open') {
      if (isPreviewablePrintFile(item.detected_file_type)) {
        setPreviewTitle(item.original_filename)
        setPreviewUrl(access.signedUrl)
      } else {
        window.open(access.signedUrl, '_blank', 'noopener,noreferrer')
      }
      return
    }

    // Print: open print-capable view when possible; never auto-mark printed.
    if (isPreviewablePrintFile(item.detected_file_type)) {
      const win = window.open(access.signedUrl, '_blank', 'noopener,noreferrer')
      if (win) {
        win.addEventListener('load', () => {
          try {
            win.focus()
            win.print()
          } catch {
            /* browser may block; secretary prints manually */
          }
        })
      }
    } else {
      window.open(access.signedUrl, '_blank', 'noopener,noreferrer')
    }
  }

  const isAssignee =
    details?.assigned_secretary_user_id != null &&
    details.assigned_secretary_user_id === actorUserId
  const canStartProcessing =
    details != null &&
    !details.assigned_secretary_user_id &&
    !['printed', 'cancelled', 'rejected'].includes(details.status)
  const isHistoryRow = details != null && ['printed', 'cancelled', 'rejected'].includes(details.status)
  const filesAvailable = details != null && !details.files_purged_at

  const orderedItems = useMemo(() => {
    if (!details?.print_items) return []
    return [...details.print_items].sort((a, b) => a.display_order - b.display_order)
  }, [details])

  function renderRequestCard(row: InstitutionPrintingRequestRow) {
    const { requiredDate, requiredTime } = describePrintingQueueRow(row, timeZone)
    const overdue = isPrintingRequestOverdue({
      requiredBy: new Date(row.required_by),
      status: row.status,
      now: new Date(),
    })
    const approaching = isApproachingPrintingDeadline({
      requiredBy: new Date(row.required_by),
      status: row.status,
      now: new Date(),
      deadlineWarningMinutes,
    })
    const updated = wasUpdatedAfterSubmission(row)
    return (
      <article
        key={row.id}
        className={[
          'secretary-printing__card',
          overdue ? 'secretary-printing__card--overdue' : '',
          approaching ? 'secretary-printing__card--warning' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="secretary-printing__card-main">
          <h3 className="secretary-printing__request-number">
            {formatPrintingRequestNumber(row.request_number)}
          </h3>
          <p className="secretary-printing__teacher">{row.teacher_full_name}</p>
          <p>
            נדרש ל־{requiredDate} {requiredTime}
          </p>
          <p className="secretary-printing__meta">
            נשלח: {new Date(row.submitted_at).toLocaleString('he-IL')} · עודכן:{' '}
            {new Date(row.updated_at).toLocaleString('he-IL')} ·{' '}
            {row.print_items?.length ?? 0} קבצים
          </p>
          <p>
            <span className={`ds-table__status ds-table__status--${row.status}`}>
              {translatePrintingRequestStatus(row.status as PrintingRequestStatus)}
            </span>
            {row.assigned_secretary_full_name ? (
              <span className="secretary-printing__assignee">
                {' '}
                · בטיפול של {row.assigned_secretary_full_name}
              </span>
            ) : (
              <span className="secretary-printing__assignee"> · לא משויך</span>
            )}
          </p>
          <div className="secretary-printing__badges" aria-live="polite">
            {overdue ? (
              <span className="secretary-printing__badge secretary-printing__badge--overdue">
                באיחור
              </span>
            ) : null}
            {approaching ? (
              <span className="secretary-printing__badge secretary-printing__badge--warning">
                מתקרב למועד
              </span>
            ) : null}
            {updated ? (
              <span className="secretary-printing__badge">עודכן לאחר השליחה</span>
            ) : null}
          </div>
        </div>
        <div className="secretary-printing__card-actions">
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={() => void openDetails(row)}
          >
            פרטים
          </button>
        </div>
      </article>
    )
  }

  function renderGroup(group: PrintingDeadlineGroup) {
    const rows = grouped[group]
    return (
      <section key={group} className="secretary-printing__group" aria-labelledby={`print-group-${group}`}>
        <h3 id={`print-group-${group}`} className="secretary-printing__group-title">
          {DEADLINE_GROUP_LABELS[group]}
          <span className="secretary-printing__group-count"> ({rows.length})</span>
        </h3>
        {rows.length === 0 ? (
          <p className="ds-state">אין בקשות בקבוצה זו.</p>
        ) : (
          <div className="secretary-printing__cards">{rows.map(renderRequestCard)}</div>
        )}
      </section>
    )
  }

  return (
    <section className="ds-card secretary-printing">
      <DashboardSection
        title="הדפסות"
        description="תור בקשות ההדפסה של המוסד — לפי מועד נדרש."
        icon={<NavPrintIcon />}
      >
        <div className="secretary-printing__tabs" role="tablist" aria-label="תצוגת הדפסות">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'active'}
            className={view === 'active' ? 'ds-btn ds-btn--primary' : 'ds-btn ds-btn--secondary'}
            onClick={() => setView('active')}
          >
            פעילות
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'history'}
            className={view === 'history' ? 'ds-btn ds-btn--primary' : 'ds-btn ds-btn--secondary'}
            onClick={() => setView('history')}
          >
            היסטוריה / הושלמו
          </button>
        </div>

        <div className="secretary-dashboard__filters secretary-printing__filters">
          <label className="ds-field">
            <span className="ds-field__label">חיפוש</span>
            <input
              className="ds-input secretary-dashboard__search"
              value={filters.search}
              onChange={(e) => patchFilters({ search: e.target.value })}
              placeholder="מורה, מספר בקשה או שם קובץ"
              aria-label="חיפוש בקשות הדפסה"
            />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">סטטוס</span>
            <select
              className="ds-select"
              value={filters.status}
              onChange={(e) => patchFilters({ status: e.target.value })}
            >
              <option value="all">הכל</option>
              {(view === 'active'
                ? ['submitted', 'in_progress', 'needs_correction']
                : ['printed', 'cancelled', 'rejected']
              ).map((status) => (
                <option key={status} value={status}>
                  {translatePrintingRequestStatus(status as PrintingRequestStatus)}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">משויך ל</span>
            <select
              className="ds-select"
              value={filters.assignee}
              onChange={(e) =>
                patchFilters({ assignee: e.target.value as SecretaryPrintingFilters['assignee'] })
              }
            >
              <option value="all">הכל</option>
              <option value="unassigned">לא משויך</option>
              {assigneeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
          {view === 'active' ? (
            <label className="ds-field">
              <span className="ds-field__label">קבוצת מועד</span>
              <select
                className="ds-select"
                value={filters.deadlineGroup}
                onChange={(e) =>
                  patchFilters({
                    deadlineGroup: e.target.value as SecretaryPrintingFilters['deadlineGroup'],
                  })
                }
              >
                <option value="all">הכל</option>
                <option value="today">היום</option>
                <option value="tomorrow">מחר</option>
                <option value="later">בהמשך</option>
              </select>
            </label>
          ) : null}
          <label className="ds-field secretary-printing__check">
            <input
              type="checkbox"
              checked={filters.overdueOnly}
              onChange={(e) => patchFilters({ overdueOnly: e.target.checked })}
            />
            באיחור בלבד
          </label>
          <label className="ds-field secretary-printing__check">
            <input
              type="checkbox"
              checked={filters.approachingOnly}
              onChange={(e) => patchFilters({ approachingOnly: e.target.checked })}
            />
            מתקרב למועד
          </label>
        </div>

        {actionMessage ? (
          <p
            className={`ds-form-message ${actionIsError ? 'ds-form-message--error' : ''}`}
            role={actionIsError ? 'alert' : 'status'}
          >
            {actionMessage}
          </p>
        ) : null}

        {isLoading ? (
          <p className="ds-state" role="status">
            טוען בקשות הדפסה…
          </p>
        ) : null}
        {loadError ? <p className="ds-form-message ds-form-message--error">{loadError}</p> : null}

        {!isLoading && !loadError && filtered.length === 0 ? (
          <p className="ds-state">
            {filters.search.trim()
              ? 'לא נמצאו בקשות התואמות לחיפוש.'
              : view === 'active'
                ? 'אין כרגע בקשות הדפסה פעילות.'
                : 'עדיין אין בקשות שהושלמו.'}
          </p>
        ) : null}

        {!isLoading && !loadError && view === 'active' && filtered.length > 0
          ? (['today', 'tomorrow', 'later'] as PrintingDeadlineGroup[]).map(renderGroup)
          : null}

        {!isLoading && !loadError && view === 'history' && filtered.length > 0 ? (
          <div className="secretary-printing__cards">{filtered.map(renderRequestCard)}</div>
        ) : null}
      </DashboardSection>

      <Modal
        isOpen={details != null}
        title={
          details
            ? `בקשת הדפסה ${formatPrintingRequestNumber(details.request_number)}`
            : 'פרטי בקשה'
        }
        onClose={() => setDetails(null)}
        size="large"
        closeLabel="סגור"
      >
        {detailsLoading ? <p role="status">מרענן פרטים…</p> : null}
        {details ? (
          <div className="secretary-printing-details">
            <p>
              מורה: <strong>{details.teacher_full_name}</strong>
            </p>
            <p>
              נדרש ל־
              {formatRequiredByDisplay(details.required_by, timeZone).date}{' '}
              {formatRequiredByDisplay(details.required_by, timeZone).time}
            </p>
            <p>
              סטטוס:{' '}
              <span className={`ds-table__status ds-table__status--${details.status}`}>
                {translatePrintingRequestStatus(details.status as PrintingRequestStatus)}
              </span>
            </p>
            <p>
              נשלח: {new Date(details.submitted_at).toLocaleString('he-IL')} · עודכן:{' '}
              {new Date(details.updated_at).toLocaleString('he-IL')}
            </p>
            {details.processing_started_at ? (
              <p>תחילת טיפול: {new Date(details.processing_started_at).toLocaleString('he-IL')}</p>
            ) : null}
            {details.assigned_secretary_full_name ? (
              <p>בטיפול של {details.assigned_secretary_full_name}</p>
            ) : (
              <p>לא משויך</p>
            )}
            {wasUpdatedAfterSubmission(details) ? (
              <p className="ds-form-message ds-form-message--warning" role="status">
                עודכן לאחר השליחה · {new Date(details.updated_at).toLocaleString('he-IL')}
              </p>
            ) : null}
            {details.files_purged_at ? (
              <p className="ds-form-message">הקובץ אינו נשמר עוד במערכת.</p>
            ) : null}

            <div className="secretary-printing-details__actions">
              {canStartProcessing ? (
                <button
                  type="button"
                  className="ds-btn ds-btn--primary"
                  disabled={busyAction === 'claim'}
                  onClick={() => void handleClaim()}
                >
                  {busyAction === 'claim' ? 'מעבד…' : 'התחלתי לטפל'}
                </button>
              ) : null}
              {isAssignee && !isHistoryRow ? (
                <>
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary"
                    onClick={() => setReleaseConfirm(true)}
                  >
                    שחרור בקשה
                  </button>
                  <label className="ds-field">
                    <span className="ds-field__label">העברה למזכירה</span>
                    <select
                      className="ds-select"
                      value={transferTargetId}
                      onChange={(e) => setTransferTargetId(e.target.value)}
                    >
                      <option value="">בחרו מזכירה</option>
                      {secretaries
                        .filter((s) => s.id !== actorUserId)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary"
                    disabled={!transferTargetId}
                    onClick={() => setTransferConfirm(true)}
                  >
                    העברת בקשה
                  </button>
                </>
              ) : null}
            </div>

            <h3 className="secretary-printing-details__items-title">קבצים להדפסה</h3>
            <ol className="secretary-printing-details__items">
              {orderedItems.map((item) => (
                <li key={item.id} className="secretary-printing-details__item">
                  <div className="secretary-printing-details__item-head">
                    <strong>
                      {item.display_order}. {item.original_filename}
                    </strong>
                    <span className={`ds-table__status ds-table__status--${item.status}`}>
                      {translatePrintItemStatus(item.status as PrintItemStatus)}
                    </span>
                  </div>
                  <p className="secretary-printing__meta">
                    {item.detected_file_type} · {formatBytes(item.file_size_bytes)}
                  </p>
                  <ul className="secretary-printing-details__settings">
                    {formatPrintItemSettingsHebrew(item).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {item.notes ? <p className="secretary-printing-details__notes">הערות: {item.notes}</p> : null}
                  {item.correction_reason ? (
                    <p className="ds-form-message">סיבת תיקון: {item.correction_reason}</p>
                  ) : null}
                  {item.rejection_reason ? (
                    <p className="ds-form-message">סיבת דחייה: {item.rejection_reason}</p>
                  ) : null}
                  {item.status === 'resubmitted' ? (
                    <p className="ds-form-message ds-form-message--warning" role="status">
                      הקובץ נשלח מחדש
                    </p>
                  ) : null}

                  <div className="secretary-printing-details__item-actions">
                    {filesAvailable && item.storage_object_path && !item.file_purged_at ? (
                      <>
                        <button
                          type="button"
                          className="ds-btn ds-btn--secondary"
                          disabled={busyAction?.startsWith('file-')}
                          onClick={() => void handleFileAction('open', item)}
                        >
                          פתיחה
                        </button>
                        <button
                          type="button"
                          className="ds-btn ds-btn--secondary"
                          disabled={busyAction?.startsWith('file-')}
                          onClick={() => void handleFileAction('download', item)}
                        >
                          הורדה
                        </button>
                        <button
                          type="button"
                          className="ds-btn ds-btn--secondary"
                          disabled={busyAction?.startsWith('file-')}
                          onClick={() => void handleFileAction('print', item)}
                        >
                          הדפסה
                        </button>
                      </>
                    ) : (
                      <p className="ds-form-message">הקובץ אינו נשמר עוד במערכת.</p>
                    )}
                    {isAssignee &&
                    !isHistoryRow &&
                    item.status !== 'printed' &&
                    item.status !== 'rejected' ? (
                      <>
                        <button
                          type="button"
                          className="ds-btn ds-btn--primary"
                          onClick={() =>
                            setItemAction({
                              kind: 'print_mark',
                              itemId: item.id,
                              filename: item.original_filename,
                            })
                          }
                        >
                          סמן כהודפס
                        </button>
                        <button
                          type="button"
                          className="ds-btn ds-btn--secondary"
                          onClick={() =>
                            setItemAction({
                              kind: 'return',
                              itemId: item.id,
                              filename: item.original_filename,
                            })
                          }
                        >
                          החזר לתיקון
                        </button>
                        <button
                          type="button"
                          className="ds-btn ds-btn--secondary"
                          onClick={() =>
                            setItemAction({
                              kind: 'reject',
                              itemId: item.id,
                              filename: item.original_filename,
                            })
                          }
                        >
                          דחייה
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={previewUrl != null}
        title={previewTitle || 'תצוגה מקדימה'}
        onClose={() => setPreviewUrl(null)}
        size="large"
      >
        {previewUrl ? (
          <iframe title={previewTitle} src={previewUrl} className="secretary-printing__preview" />
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={releaseConfirm}
        title="שחרור בקשת הדפסה"
        message={
          details
            ? `לשחרר את ${formatPrintingRequestNumber(details.request_number)} לתור המשותף?`
            : ''
        }
        continueLabel="המשך"
        confirmLabel="שחרור"
        onContinue={() => {
          if (!busyAction) setReleaseConfirm(false)
        }}
        onConfirm={() => void handleRelease()}
      />

      <ConfirmDialog
        isOpen={transferConfirm}
        title="העברת בקשת הדפסה"
        message={
          details
            ? `להעביר את ${formatPrintingRequestNumber(details.request_number)} למזכירה שנבחרה?`
            : ''
        }
        continueLabel="המשך"
        confirmLabel="העברה"
        onContinue={() => {
          if (!busyAction) setTransferConfirm(false)
        }}
        onConfirm={() => void handleTransfer()}
      />

      <ConfirmDialog
        isOpen={itemAction?.kind === 'print_mark'}
        title="סמן כהודפס"
        message={
          itemAction?.kind === 'print_mark'
            ? `לסמן את הקובץ ${itemAction.filename} כהודפס? פעולת הדפסה בדפדפן אינה מסמנת אוטומטית.`
            : ''
        }
        continueLabel="המשך"
        confirmLabel="סמן כהודפס"
        onContinue={() => {
          if (!busyAction) setItemAction(null)
        }}
        onConfirm={() => void runItemAction()}
      />

      <Modal
        isOpen={itemAction?.kind === 'return' || itemAction?.kind === 'reject'}
        title={itemAction?.kind === 'return' ? 'החזרה לתיקון' : 'דחיית פריט'}
        onClose={() => {
          if (!busyAction) {
            setItemAction(null)
            setItemReason('')
          }
        }}
        size="medium"
      >
        {itemAction ? (
          <div className="secretary-printing__reason-panel">
            <p>
              {itemAction.kind === 'return' ? 'החזרה לתיקון של' : 'דחייה של'}{' '}
              <strong>{itemAction.filename}</strong>
            </p>
            <label className="ds-field">
              <span className="ds-field__label">סיבה (חובה)</span>
              <textarea
                className="ds-textarea"
                value={itemReason}
                onChange={(e) => setItemReason(e.target.value)}
                rows={3}
                aria-label="סיבה לפעולה"
              />
            </label>
            <div className="secretary-printing-details__item-actions">
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  setItemAction(null)
                  setItemReason('')
                }}
              >
                ביטול
              </button>
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                disabled={Boolean(busyAction) || !itemReason.trim()}
                onClick={() => void runItemAction()}
              >
                אישור
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  )
}
