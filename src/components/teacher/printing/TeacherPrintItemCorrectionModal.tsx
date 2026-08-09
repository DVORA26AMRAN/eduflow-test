import { useMemo, useState } from 'react'
import type {
  ColorMode,
  DuplexFlipMode,
  Orientation,
  PageSelectionMode,
  PagesPerSheet,
  PaperSize,
  ScaleMode,
  Sides,
} from '../../../types/printing'
import {
  resubmitPrintItem,
  uploadPrintingFile,
} from '../../../services/printingRequests'
import {
  DEFAULT_PRINT_ITEM_SETTINGS,
  draftItemToInput,
  guessMimeFromFilename,
  mapPrintingErrorCode,
  PRINTING_ACCEPT_ATTRIBUTE,
  PRINTING_PAPER_SIZE_OPTIONS,
  PRINTING_PAGES_PER_SHEET_OPTIONS,
  validateDraftItemSettings,
  validatePrintingFileClient,
  type PrintingDraftItem,
} from '../../../utils/printingUi'
import { Modal } from '../../ui/Modal'

export type CorrectionItemSource = {
  id: string
  printingRequestId: string
  institutionId: string
  original_filename: string
  detected_file_type: string
  file_size_bytes: number
  storage_object_path: string | null
  page_selection_mode: string
  page_selection_value: string | null
  copies: number
  color_mode: string
  paper_size: string
  orientation: string
  sides: string
  duplex_flip_mode: string | null
  pages_per_sheet: number
  scale_mode: string
  custom_scale_percent: number | null
  collate: boolean
  notes: string | null
  correction_reason: string | null
}

type TeacherPrintItemCorrectionModalProps = {
  isOpen: boolean
  item: CorrectionItemSource | null
  onClose: () => void
  onResubmitted: () => void
}

function toDraft(item: CorrectionItemSource): PrintingDraftItem {
  return {
    localId: item.id,
    existingItemId: item.id,
    file: null,
    previewUrl: null,
    uploadState: 'uploaded',
    uploadError: null,
    storageObjectPath: item.storage_object_path,
    original_filename: item.original_filename,
    detected_file_type: item.detected_file_type,
    file_size_bytes: item.file_size_bytes,
    page_selection_mode:
      (item.page_selection_mode as PageSelectionMode) ??
      DEFAULT_PRINT_ITEM_SETTINGS.page_selection_mode,
    page_selection_value: item.page_selection_value,
    copies: item.copies || 1,
    color_mode: (item.color_mode as ColorMode) ?? DEFAULT_PRINT_ITEM_SETTINGS.color_mode,
    paper_size: (item.paper_size as PaperSize) ?? DEFAULT_PRINT_ITEM_SETTINGS.paper_size,
    orientation: (item.orientation as Orientation) ?? DEFAULT_PRINT_ITEM_SETTINGS.orientation,
    sides: (item.sides as Sides) ?? DEFAULT_PRINT_ITEM_SETTINGS.sides,
    duplex_flip_mode: (item.duplex_flip_mode as DuplexFlipMode | null) ?? null,
    pages_per_sheet: (item.pages_per_sheet as PagesPerSheet) ?? 1,
    scale_mode: (item.scale_mode as ScaleMode) ?? DEFAULT_PRINT_ITEM_SETTINGS.scale_mode,
    custom_scale_percent: item.custom_scale_percent,
    notes: item.notes,
    collate: item.collate,
  }
}

export function TeacherPrintItemCorrectionModal({
  isOpen,
  item,
  onClose,
  onResubmitted,
}: TeacherPrintItemCorrectionModalProps) {
  const [draft, setDraft] = useState<PrintingDraftItem | null>(null)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hydratedItemId, setHydratedItemId] = useState<string | null>(null)

  if (isOpen && item && item.id !== hydratedItemId) {
    setHydratedItemId(item.id)
    setDraft(toDraft(item))
    setError('')
    setIsSubmitting(false)
  }

  if (!isOpen && hydratedItemId !== null) {
    setHydratedItemId(null)
  }

  const settingsError = useMemo(
    () => (draft ? validateDraftItemSettings(draft) : null),
    [draft],
  )

  function patch(partial: Partial<PrintingDraftItem>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev))
  }

  function handleFile(fileList: FileList | null) {
    if (!fileList?.[0] || !draft || !item) return
    const file = fileList[0]
    const validation = validatePrintingFileClient(file)
    if (!validation.ok) {
      setError(validation.errorMessage)
      return
    }
    const mime = file.type || guessMimeFromFilename(file.name)
    const replacementPath = `${item.institutionId}/${item.printingRequestId}/${item.id}/${crypto.randomUUID()}`
    setError('')
    setDraft({
      ...draft,
      file,
      original_filename: file.name,
      detected_file_type: mime,
      file_size_bytes: file.size,
      storageObjectPath: replacementPath,
      uploadState: 'waiting',
      uploadError: null,
    })
  }

  async function handleResubmit() {
    if (!draft || !item || isSubmitting) return
    if (settingsError) {
      setError(settingsError)
      return
    }
    setIsSubmitting(true)
    setError('')

    if (draft.file && draft.storageObjectPath) {
      const upload = await uploadPrintingFile({
        storageObjectPath: draft.storageObjectPath,
        file: draft.file,
        contentType: draft.detected_file_type,
      })
      if (!upload.ok) {
        setIsSubmitting(false)
        setError(upload.errorMessage || mapPrintingErrorCode('PRINT_FILE_REPLACEMENT_FAILED'))
        return
      }
    }

    const payload = draftItemToInput(draft, 1)
    const result = await resubmitPrintItem({
      printItemId: item.id,
      item: payload,
    })
    setIsSubmitting(false)
    if (!result.ok) {
      setError(mapPrintingErrorCode(result.error_code))
      return
    }
    onResubmitted()
    onClose()
  }

  if (!item || !draft) {
    return (
      <Modal isOpen={isOpen} title="תיקון קובץ" onClose={onClose} size="large">
        <p role="status">טוען…</p>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} title="תיקון קובץ" onClose={onClose} size="large" closeLabel="סגור">
      <div className="printing-modal">
        <p className="ds-form-message ds-form-message--warning" role="status">
          סיבת התיקון: {item.correction_reason || '—'}
        </p>
        <p>
          קובץ נוכחי: <strong>{draft.original_filename}</strong>
        </p>

        <label className="ds-field">
          <span className="ds-field__label">החלפת קובץ (אופציונלי)</span>
          <input
            type="file"
            accept={PRINTING_ACCEPT_ATTRIBUTE}
            onChange={(e) => handleFile(e.target.files)}
            disabled={isSubmitting}
          />
        </label>

        <fieldset className="printing-item__fieldset">
          <legend>הגדרות הדפסה</legend>
          <label className="ds-field">
            <span className="ds-field__label">עמודים</span>
            <select
              className="ds-select"
              value={draft.page_selection_mode}
              onChange={(e) =>
                patch({
                  page_selection_mode: e.target.value as PageSelectionMode,
                  page_selection_value:
                    e.target.value === 'all' ? null : draft.page_selection_value,
                })
              }
            >
              <option value="all">כל העמודים</option>
              <option value="custom">מותאם</option>
            </select>
          </label>
          {draft.page_selection_mode === 'custom' ? (
            <label className="ds-field">
              <span className="ds-field__label">בחירת עמודים</span>
              <input
                className="ds-input"
                value={draft.page_selection_value ?? ''}
                onChange={(e) => patch({ page_selection_value: e.target.value })}
                placeholder="1-3 או 1,3,5"
              />
            </label>
          ) : null}
          <label className="ds-field">
            <span className="ds-field__label">עותקים</span>
            <input
              className="ds-input"
              type="number"
              min={1}
              max={500}
              value={draft.copies}
              onChange={(e) => patch({ copies: Math.trunc(Number(e.target.value) || 1) })}
            />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">צבע</span>
            <select
              className="ds-select"
              value={draft.color_mode}
              onChange={(e) => patch({ color_mode: e.target.value as ColorMode })}
            >
              <option value="black_and_white">שחור-לבן</option>
              <option value="color">צבעוני</option>
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">גודל נייר</span>
            <select
              className="ds-select"
              value={draft.paper_size}
              onChange={(e) => patch({ paper_size: e.target.value as PaperSize })}
            >
              {PRINTING_PAPER_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">כיוון</span>
            <select
              className="ds-select"
              value={draft.orientation}
              onChange={(e) => patch({ orientation: e.target.value as Orientation })}
            >
              <option value="portrait">לאורך</option>
              <option value="landscape">לרוחב</option>
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">צדדים</span>
            <select
              className="ds-select"
              value={draft.sides}
              onChange={(e) => {
                const sides = e.target.value as Sides
                patch({
                  sides,
                  duplex_flip_mode: sides === 'double_sided' ? draft.duplex_flip_mode ?? 'long_edge' : null,
                })
              }}
            >
              <option value="single_sided">חד-צדדי</option>
              <option value="double_sided">דו-צדדי</option>
            </select>
          </label>
          {draft.sides === 'double_sided' ? (
            <label className="ds-field">
              <span className="ds-field__label">היפוך</span>
              <select
                className="ds-select"
                value={draft.duplex_flip_mode ?? 'long_edge'}
                onChange={(e) => patch({ duplex_flip_mode: e.target.value as DuplexFlipMode })}
              >
                <option value="long_edge">היפוך בצד הארוך</option>
                <option value="short_edge">היפוך בצד הקצר</option>
              </select>
            </label>
          ) : null}
          <label className="ds-field">
            <span className="ds-field__label">עמודים בגיליון</span>
            <select
              className="ds-select"
              value={draft.pages_per_sheet}
              onChange={(e) =>
                patch({ pages_per_sheet: Number(e.target.value) as PagesPerSheet })
              }
            >
              {PRINTING_PAGES_PER_SHEET_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">התאמה</span>
            <select
              className="ds-select"
              value={draft.scale_mode}
              onChange={(e) => patch({ scale_mode: e.target.value as ScaleMode })}
            >
              <option value="fit_to_page">התאמה לדף</option>
              <option value="original_100">100%</option>
              <option value="custom">מותאם</option>
            </select>
          </label>
          {draft.scale_mode === 'custom' ? (
            <label className="ds-field">
              <span className="ds-field__label">אחוז</span>
              <input
                className="ds-input"
                type="number"
                min={10}
                max={400}
                value={draft.custom_scale_percent ?? 100}
                onChange={(e) =>
                  patch({ custom_scale_percent: Math.trunc(Number(e.target.value) || 100) })
                }
              />
            </label>
          ) : null}
          <label className="ds-field">
            <span className="ds-field__label">איגוד עותקים</span>
            <select
              className="ds-select"
              value={draft.collate ? 'yes' : 'no'}
              onChange={(e) => patch({ collate: e.target.value === 'yes' })}
            >
              <option value="yes">עותקים מאוגדים</option>
              <option value="no">עותקים לא מאוגדים</option>
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">הערות</span>
            <textarea
              className="ds-textarea"
              rows={3}
              value={draft.notes ?? ''}
              onChange={(e) => patch({ notes: e.target.value || null })}
            />
          </label>
        </fieldset>

        {error || settingsError ? (
          <p className="ds-form-message ds-form-message--error" role="alert">
            {error || settingsError}
          </p>
        ) : null}

        <div className="printing-modal__actions">
          <button type="button" className="ds-btn ds-btn--secondary" onClick={onClose} disabled={isSubmitting}>
            ביטול
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            disabled={isSubmitting || Boolean(settingsError)}
            onClick={() => void handleResubmit()}
          >
            {isSubmitting ? 'שולח…' : 'שליחה מחדש'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
