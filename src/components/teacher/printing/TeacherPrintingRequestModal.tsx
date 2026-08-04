import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, ConfirmDialog } from '../../ui/Modal'
import { PrintItemEditor } from './PrintItemEditor'
import {
  MAX_PRINT_ITEMS_PER_REQUEST,
  MIN_PRINT_ITEMS_PER_REQUEST,
} from '../../../types/printing'
import {
  PRINTING_ACCEPT_ATTRIBUTE,
  PRINTING_ACCEPTED_FILE_HINT,
  advanceNoticeHebrewMessage,
  buildRequiredByIso,
  copySettingsFromPrevious,
  createEmptyDraftItem,
  draftItemToInput,
  formatPrintingRequestNumber,
  formatRequiredByDisplay,
  isRequiredByTooLateClient,
  mapPrintingErrorCode,
  moveDraftItem,
  validateDraftItemSettings,
  validatePrintingFileClient,
  type PrintingDraftItem,
} from '../../../utils/printingUi'
import {
  createPrintingRequest,
  updatePrintingRequest,
  uploadPrintingFile,
} from '../../../services/printingRequests'

type TeacherPrintingRequestModalProps = {
  isOpen: boolean
  mode: 'create' | 'edit'
  teacherFullName: string
  teacherUserId: string
  institutionTimeZone: string
  minimumPrintNoticeMinutes: number
  editingRequestId?: string | null
  initialRequiredByIso?: string | null
  initialItems?: PrintingDraftItem[]
  onClose: () => void
  onSubmitted: (info: { requestNumber: number; printingRequestId: string }) => void
}

type Step = 'configure' | 'summary' | 'success'

const EMPTY_DRAFT_ITEMS: PrintingDraftItem[] = []

export function TeacherPrintingRequestModal({
  isOpen,
  mode,
  teacherFullName,
  teacherUserId: _teacherUserId,
  institutionTimeZone,
  minimumPrintNoticeMinutes,
  editingRequestId = null,
  initialRequiredByIso = null,
  initialItems = EMPTY_DRAFT_ITEMS,
  onClose,
  onSubmitted,
}: TeacherPrintingRequestModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('configure')
  const [requiredDate, setRequiredDate] = useState('')
  const [requiredTime, setRequiredTime] = useState('')
  const [items, setItems] = useState<PrintingDraftItem[]>([])
  const [moreOpenById, setMoreOpenById] = useState<Record<string, boolean>>({})
  const [formError, setFormError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successNumber, setSuccessNumber] = useState<number | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setStep('configure')
    setFormError('')
    setIsSubmitting(false)
    setSuccessNumber(null)
    setConfirmClose(false)
    setMoreOpenById({})

    if (initialRequiredByIso) {
      const d = new Date(initialRequiredByIso)
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: institutionTimeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        })
          .formatToParts(d)
          .map((p) => [p.type, p.value]),
      ) as Record<string, string>
      setRequiredDate(`${parts.year}-${parts.month}-${parts.day}`)
      setRequiredTime(`${parts.hour}:${parts.minute}`)
    } else {
      setRequiredDate('')
      setRequiredTime('')
    }

    setItems(initialItems)
    // Reset draft only when the dialog opens (or edit payload identity changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional open-gated reset
  }, [isOpen, editingRequestId, mode])

  useEffect(() => {
    return () => {
      for (const item of items) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only for current previews
  }, [])

  const requiredByIso = useMemo(() => {
    if (!requiredDate || !requiredTime) return null
    return buildRequiredByIso({
      date: requiredDate,
      time: requiredTime,
      timeZone: institutionTimeZone,
    })
  }, [requiredDate, requiredTime, institutionTimeZone])

  const deadlineTooLate =
    requiredByIso != null &&
    isRequiredByTooLateClient({
      requiredByIso,
      minimumPrintNoticeMinutes,
    })

  const itemErrors = items.map((item) => validateDraftItemSettings(item))
  const hasItemErrors = itemErrors.some(Boolean)
  const canProceedToSummary =
    Boolean(requiredByIso) &&
    !deadlineTooLate &&
    items.length >= MIN_PRINT_ITEMS_PER_REQUEST &&
    items.length <= MAX_PRINT_ITEMS_PER_REQUEST &&
    !hasItemErrors &&
    items.every((i) => i.file || i.storageObjectPath)

  function handleCloseAttempt() {
    if (isSubmitting) return
    if (step === 'success') {
      onClose()
      return
    }
    if (items.length > 0 || requiredDate || requiredTime) {
      setConfirmClose(true)
      return
    }
    onClose()
  }

  function handleAddFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setFormError('')
    const remaining = MAX_PRINT_ITEMS_PER_REQUEST - items.length
    if (remaining <= 0) {
      setFormError(`ניתן לצרף עד ${MAX_PRINT_ITEMS_PER_REQUEST} קבצים לבקשה.`)
      return
    }
    const next: PrintingDraftItem[] = [...items]
    for (const file of Array.from(fileList).slice(0, remaining)) {
      const validation = validatePrintingFileClient(file)
      if (!validation.ok) {
        setFormError(validation.errorMessage)
        continue
      }
      next.push(createEmptyDraftItem(file))
    }
    setItems(next)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit() {
    if (!canProceedToSummary || !requiredByIso || isSubmitting) return
    setIsSubmitting(true)
    setFormError('')

    const payloadItems = items.map((item, index) => draftItemToInput(item, index + 1))

    if (mode === 'edit' && editingRequestId) {
      const result = await updatePrintingRequest({
        printingRequestId: editingRequestId,
        requiredBy: requiredByIso,
        items: payloadItems,
      })
      if (!result.ok) {
        setIsSubmitting(false)
        setFormError(mapPrintingErrorCode(result.error_code))
        setStep('configure')
        return
      }
      for (let i = 0; i < items.length; i++) {
        const draft = items[i]
        if (!draft.file || !draft.storageObjectPath) continue
        const upload = await uploadPrintingFile({
          storageObjectPath: draft.storageObjectPath,
          file: draft.file,
          contentType: draft.detected_file_type,
        })
        if (!upload.ok) {
          setIsSubmitting(false)
          setFormError(upload.errorMessage)
          setStep('configure')
          return
        }
      }
      setIsSubmitting(false)
      setSuccessNumber(null)
      setStep('success')
      onSubmitted({ requestNumber: 0, printingRequestId: editingRequestId })
      return
    }

    const result = await createPrintingRequest({
      requiredBy: requiredByIso,
      items: payloadItems,
    })

    if (!result.ok) {
      setIsSubmitting(false)
      setFormError(mapPrintingErrorCode(result.error_code))
      setStep('configure')
      return
    }

    const createdItems = result.items ?? []
    for (let i = 0; i < items.length; i++) {
      const draft = items[i]
      const created = createdItems[i]
      if (!draft.file || !created?.storage_object_path) continue
      setItems((prev) =>
        prev.map((it, idx) =>
          idx === i ? { ...it, uploadState: 'uploading', uploadError: null } : it,
        ),
      )
      const upload = await uploadPrintingFile({
        storageObjectPath: created.storage_object_path,
        file: draft.file,
        contentType: draft.detected_file_type,
      })
      if (!upload.ok) {
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i
              ? { ...it, uploadState: 'failed', uploadError: upload.errorMessage }
              : it,
          ),
        )
        setIsSubmitting(false)
        setFormError(upload.errorMessage)
        setStep('configure')
        return
      }
      setItems((prev) =>
        prev.map((it, idx) =>
          idx === i
            ? {
                ...it,
                uploadState: 'uploaded',
                storageObjectPath: created.storage_object_path,
              }
            : it,
        ),
      )
    }

    setIsSubmitting(false)
    setSuccessNumber(result.request_number)
    setStep('success')
    onSubmitted({
      requestNumber: result.request_number,
      printingRequestId: result.printing_request_id,
    })
  }

  const summaryDisplay =
    requiredByIso != null
      ? formatRequiredByDisplay(requiredByIso, institutionTimeZone)
      : null

  return (
    <>
      <Modal
        isOpen={isOpen}
        title={mode === 'edit' ? 'עריכת בקשת הדפסה' : 'בקשת הדפסה חדשה'}
        onClose={handleCloseAttempt}
        size="large"
        closeLabel="סגור"
      >
        {step === 'configure' ? (
          <div className="printing-modal">
            <div className="printing-modal__identity">
              <label className="ds-field">
                <span className="ds-label">שם המורה</span>
                <input className="ds-input" value={teacherFullName} readOnly aria-readonly="true" />
              </label>
              <div className="printing-modal__deadline">
                <label className="ds-field">
                  <span className="ds-label">נדרש לתאריך</span>
                  <input
                    className="ds-input"
                    type="date"
                    value={requiredDate}
                    onChange={(e) => setRequiredDate(e.target.value)}
                    disabled={isSubmitting}
                  />
                </label>
                <label className="ds-field">
                  <span className="ds-label">שעה</span>
                  <input
                    className="ds-input"
                    type="time"
                    value={requiredTime}
                    onChange={(e) => setRequiredTime(e.target.value)}
                    disabled={isSubmitting}
                  />
                </label>
              </div>
              {deadlineTooLate ? (
                <p className="ds-form-message ds-form-message--error" role="alert">
                  {advanceNoticeHebrewMessage(minimumPrintNoticeMinutes)}
                </p>
              ) : (
                <p className="ds-form-message">
                  יש לשלוח לפחות {minimumPrintNoticeMinutes} דקות לפני המועד הנדרש.
                </p>
              )}
            </div>

            <div className="printing-modal__files">
              <div className="printing-modal__files-head">
                <h3 className="printing-modal__subtitle">קבצים להדפסה</h3>
                <p className="printing-modal__hint">{PRINTING_ACCEPTED_FILE_HINT}</p>
              </div>

              {items.length === 0 ? (
                <p className="ds-state">יש להוסיף לפחות קובץ אחד.</p>
              ) : null}

              <ul className="printing-modal__item-list">
                {items.map((item, index) => (
                  <li
                    key={item.localId}
                    draggable={!isSubmitting}
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex == null) return
                      setItems((prev) => moveDraftItem(prev, dragIndex, index))
                      setDragIndex(null)
                    }}
                  >
                    <PrintItemEditor
                      item={item}
                      index={index}
                      total={items.length}
                      showCopyPrevious={index > 0}
                      moreOpen={Boolean(moreOpenById[item.localId])}
                      disabled={isSubmitting}
                      onToggleMore={() =>
                        setMoreOpenById((prev) => ({
                          ...prev,
                          [item.localId]: !prev[item.localId],
                        }))
                      }
                      onChange={(next) =>
                        setItems((prev) =>
                          prev.map((it) => (it.localId === item.localId ? next : it)),
                        )
                      }
                      onCopyPrevious={() =>
                        setItems((prev) =>
                          prev.map((it, idx) =>
                            idx === index ? copySettingsFromPrevious(it, prev[index - 1]) : it,
                          ),
                        )
                      }
                      onRemove={() => {
                        setItems((prev) => {
                          const removed = prev.find((it) => it.localId === item.localId)
                          if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
                          return prev.filter((it) => it.localId !== item.localId)
                        })
                      }}
                      onMoveUp={() =>
                        setItems((prev) => moveDraftItem(prev, index, Math.max(0, index - 1)))
                      }
                      onMoveDown={() =>
                        setItems((prev) =>
                          moveDraftItem(prev, index, Math.min(prev.length - 1, index + 1)),
                        )
                      }
                    />
                  </li>
                ))}
              </ul>

              <div className="printing-modal__add">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="visually-hidden"
                  accept={PRINTING_ACCEPT_ATTRIBUTE}
                  multiple
                  disabled={isSubmitting || items.length >= MAX_PRINT_ITEMS_PER_REQUEST}
                  onChange={(e) => handleAddFiles(e.target.files)}
                />
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  disabled={isSubmitting || items.length >= MAX_PRINT_ITEMS_PER_REQUEST}
                  onClick={() => fileInputRef.current?.click()}
                >
                  + העלאת קובץ נוסף
                </button>
                {items.length >= MAX_PRINT_ITEMS_PER_REQUEST ? (
                  <p className="ds-form-message">
                    הגעתם למקסימום של {MAX_PRINT_ITEMS_PER_REQUEST} קבצים בבקשה.
                  </p>
                ) : null}
              </div>
            </div>

            {formError ? (
              <p className="ds-form-message ds-form-message--error" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="ds-form-actions">
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                onClick={handleCloseAttempt}
                disabled={isSubmitting}
              >
                ביטול
              </button>
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                disabled={!canProceedToSummary || isSubmitting}
                onClick={() => setStep('summary')}
              >
                המשך לסיכום
              </button>
            </div>
          </div>
        ) : null}

        {step === 'summary' && summaryDisplay ? (
          <div className="printing-modal">
            <h3 className="printing-modal__subtitle">סיכום בקשת הדפסה</h3>
            <p>
              נדרש לתאריך: {summaryDisplay.date}
              <br />
              שעה: {summaryDisplay.time}
            </p>
            <p>{items.length} קבצים</p>
            <ol className="printing-modal__summary-list">
              {items.map((item) => (
                <li key={item.localId}>
                  <strong>{item.original_filename}</strong>
                  <ul>
                    <li>{item.copies} עותקים</li>
                    <li>
                      {item.page_selection_mode === 'all'
                        ? 'כל העמודים'
                        : `עמודים ${item.page_selection_value}`}
                    </li>
                    <li>{item.paper_size.toUpperCase()}</li>
                    <li>{item.color_mode === 'color' ? 'צבעוני' : 'שחור־לבן'}</li>
                    <li>{item.sides === 'double_sided' ? 'דו־צדדי' : 'חד־צדדי'}</li>
                    {item.sides === 'double_sided' ? (
                      <li>
                        {item.duplex_flip_mode === 'short_edge'
                          ? 'היפוך בצד הקצר'
                          : 'היפוך בצד הארוך'}
                      </li>
                    ) : null}
                    {item.notes ? <li>הערה: {item.notes}</li> : null}
                  </ul>
                </li>
              ))}
            </ol>
            {formError ? (
              <p className="ds-form-message ds-form-message--error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="ds-form-actions">
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                disabled={isSubmitting}
                onClick={() => setStep('configure')}
              >
                חזרה לעריכה
              </button>
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                disabled={isSubmitting}
                onClick={() => void handleSubmit()}
              >
                {isSubmitting ? 'שולח…' : 'שלח בקשת הדפסה'}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'success' ? (
          <div className="printing-modal">
            <p className="ds-form-message ds-form-message--success" role="status">
              {successNumber
                ? `בקשת הדפסה ${formatPrintingRequestNumber(successNumber)} נשלחה בהצלחה`
                : 'בקשת ההדפסה עודכנה בהצלחה'}
            </p>
            <div className="ds-form-actions">
              <button type="button" className="ds-btn ds-btn--primary" onClick={onClose}>
                סגור
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={confirmClose}
        title="לסגור את הטופס?"
        message="השינויים שלא נשלחו לא יישמרו."
        continueLabel="המשך בעריכה"
        confirmLabel="סגור ללא שמירה"
        onContinue={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false)
          onClose()
        }}
      />
    </>
  )
}
