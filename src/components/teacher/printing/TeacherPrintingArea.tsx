import { useEffect, useState } from 'react'
import { MyPrintingRequestsPanel } from './MyPrintingRequestsPanel'
import { TeacherPrintingRequestModal } from './TeacherPrintingRequestModal'
import './printing.css'
import {
  getAuthorizedPrintingRequest,
  loadInstitutionPrintingSettings,
} from '../../../services/printingRequests'
import {
  DEFAULT_PRINT_ITEM_SETTINGS,
  type PrintingDraftItem,
} from '../../../utils/printingUi'
import type { DuplexFlipMode, PageSelectionMode, PagesPerSheet, PaperSize, ScaleMode, Sides, ColorMode, Orientation } from '../../../types/printing'

type TeacherPrintingAreaProps = {
  teacherUserId: string
  teacherFullName: string
  institutionId: string
  institutionTimeZone: string
  onBack: () => void
  focusRequestId?: string | null
}

type View = 'home' | 'my-requests'

export function TeacherPrintingArea({
  teacherUserId,
  teacherFullName,
  institutionId,
  institutionTimeZone,
  onBack,
  focusRequestId = null,
}: TeacherPrintingAreaProps) {
  const [view, setView] = useState<View>(focusRequestId ? 'my-requests' : 'home')
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsError, setSettingsError] = useState('')
  const [minimumNotice, setMinimumNotice] = useState(60)
  const [timeZone, setTimeZone] = useState(institutionTimeZone)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editItems, setEditItems] = useState<PrintingDraftItem[]>([])
  const [editRequiredBy, setEditRequiredBy] = useState<string | null>(null)
  const [listRefresh, setListRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setSettingsLoading(true)
      const result = await loadInstitutionPrintingSettings(institutionId)
      if (cancelled) return
      if (!result.ok) {
        setSettingsError(result.errorMessage)
        setSettingsLoading(false)
        return
      }
      setMinimumNotice(result.minimumPrintNoticeMinutes)
      setTimeZone(result.timeZone || institutionTimeZone)
      setSettingsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [institutionId, institutionTimeZone])

  function openCreate() {
    setModalMode('create')
    setEditingId(null)
    setEditItems([])
    setEditRequiredBy(null)
    setModalOpen(true)
  }

  async function openEdit(requestId: string) {
    const { data, error } = await getAuthorizedPrintingRequest(requestId)
    if (error || !data) {
      setSettingsError('טעינת הבקשה לעריכה נכשלה.')
      return
    }
    if (
      data.assigned_secretary_user_id ||
      data.processing_started_at ||
      (data.status !== 'submitted' && data.status !== 'needs_correction')
    ) {
      setSettingsError('הטיפול בבקשה כבר התחיל ולכן לא ניתן לערוך אותה.')
      return
    }
    const rawItems = Array.isArray(data.print_items) ? data.print_items : []
    const sorted = [...rawItems].sort(
      (a: { display_order?: number }, b: { display_order?: number }) =>
        (a.display_order ?? 0) - (b.display_order ?? 0),
    )
    const drafts: PrintingDraftItem[] = sorted.map((item: Record<string, unknown>) => ({
      localId: String(item.id),
      existingItemId: String(item.id),
      file: null,
      previewUrl: null,
      uploadState: 'uploaded',
      uploadError: null,
      storageObjectPath: (item.storage_object_path as string) ?? null,
      original_filename: String(item.original_filename ?? ''),
      detected_file_type: String(item.detected_file_type ?? ''),
      file_size_bytes: Number(item.file_size_bytes ?? 0),
      page_selection_mode: (item.page_selection_mode as PageSelectionMode) ?? DEFAULT_PRINT_ITEM_SETTINGS.page_selection_mode,
      page_selection_value: (item.page_selection_value as string | null) ?? null,
      copies: Number(item.copies ?? 1),
      color_mode: (item.color_mode as ColorMode) ?? DEFAULT_PRINT_ITEM_SETTINGS.color_mode,
      paper_size: (item.paper_size as PaperSize) ?? DEFAULT_PRINT_ITEM_SETTINGS.paper_size,
      orientation: (item.orientation as Orientation) ?? DEFAULT_PRINT_ITEM_SETTINGS.orientation,
      sides: (item.sides as Sides) ?? DEFAULT_PRINT_ITEM_SETTINGS.sides,
      duplex_flip_mode: (item.duplex_flip_mode as DuplexFlipMode | null) ?? null,
      pages_per_sheet: (Number(item.pages_per_sheet) as PagesPerSheet) || 1,
      scale_mode: (item.scale_mode as ScaleMode) ?? DEFAULT_PRINT_ITEM_SETTINGS.scale_mode,
      custom_scale_percent: (item.custom_scale_percent as number | null) ?? null,
      collate: item.collate !== false,
      notes: (item.notes as string | null) ?? null,
    }))
    setModalMode('edit')
    setEditingId(requestId)
    setEditItems(drafts)
    setEditRequiredBy(String(data.required_by))
    setModalOpen(true)
  }

  return (
    <section className="printing-area" aria-label="הדפסות">
      <div className="printing-area__toolbar">
        <button type="button" className="ds-btn ds-btn--secondary" onClick={onBack}>
          חזרה לקטגוריות
        </button>
      </div>

      {settingsLoading ? <p role="status">טוען…</p> : null}
      {settingsError ? (
        <p className="ds-form-message ds-form-message--error">{settingsError}</p>
      ) : null}

      {view === 'home' ? (
        <div className="printing-home">
          <h3 className="printing-home__title">הדפסות</h3>
          <p className="printing-home__lead">בחרו פעולה:</p>
          <div className="printing-home__actions">
            <button
              type="button"
              className="teacher-dashboard__category-card"
              onClick={openCreate}
              disabled={settingsLoading}
            >
              <span className="teacher-dashboard__category-title">בקשת הדפסה חדשה</span>
              <span className="teacher-dashboard__category-description">
                העלאת קבצים והגדרת הדפסה
              </span>
            </button>
            <button
              type="button"
              className="teacher-dashboard__category-card"
              onClick={() => setView('my-requests')}
              disabled={settingsLoading}
            >
              <span className="teacher-dashboard__category-title">בקשות ההדפסה שלי</span>
              <span className="teacher-dashboard__category-description">
                מעקב, עריכה וביטול לפני תחילת טיפול
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="printing-area__toolbar">
            <button
              type="button"
              className="ds-btn ds-btn--secondary"
              onClick={() => setView('home')}
            >
              חזרה לתפריט הדפסות
            </button>
            <button type="button" className="ds-btn ds-btn--primary" onClick={openCreate}>
              בקשת הדפסה חדשה
            </button>
          </div>
          <MyPrintingRequestsPanel
            teacherUserId={teacherUserId}
            institutionTimeZone={timeZone}
            refreshToken={listRefresh}
            onEditRequest={(id) => void openEdit(id)}
            onCreateNew={openCreate}
            focusRequestId={focusRequestId}
          />
        </div>
      )}

      <TeacherPrintingRequestModal
        isOpen={modalOpen}
        mode={modalMode}
        teacherFullName={teacherFullName}
        teacherUserId={teacherUserId}
        institutionTimeZone={timeZone}
        minimumPrintNoticeMinutes={minimumNotice}
        editingRequestId={editingId}
        initialRequiredByIso={editRequiredBy}
        initialItems={editItems}
        onClose={() => setModalOpen(false)}
        onSubmitted={() => {
          setListRefresh((n) => n + 1)
          setView('my-requests')
        }}
      />
    </section>
  )
}