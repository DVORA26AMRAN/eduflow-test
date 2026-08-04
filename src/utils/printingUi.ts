import type {
  ColorMode,
  Orientation,
  PageSelectionMode,
  PagesPerSheet,
  PaperSize,
  PrintItemInput,
  PrintItemStatus,
  PrintingErrorCode,
  PrintingRequestStatus,
  ScaleMode,
  Sides,
  DuplexFlipMode,
} from '../types/printing'
import {
  MAX_PRINT_COPIES,
  MAX_PRINT_FILE_SIZE_BYTES,
  MAX_PRINT_ITEMS_PER_REQUEST,
  PRINTING_ALLOWED_MIME_TYPES,
} from '../types/printing'
import {
  isAllowedPrintingMimeType,
  isPrintingRequestTooLate,
  isValidPageSelection,
  requiredByFromInstitutionLocal,
  validatePrintItemInput,
} from '../domain/printing/validation'
import { canTeacherEditOrCancel } from '../domain/printing/lifecycle'

/** Shared default print settings for every new Print Item (single source). */
export const DEFAULT_PRINT_ITEM_SETTINGS = {
  page_selection_mode: 'all' as PageSelectionMode,
  page_selection_value: null as string | null,
  copies: 1,
  color_mode: 'black_and_white' as ColorMode,
  paper_size: 'a4' as PaperSize,
  orientation: 'portrait' as Orientation,
  sides: 'single_sided' as Sides,
  duplex_flip_mode: null as DuplexFlipMode | null,
  pages_per_sheet: 1 as PagesPerSheet,
  scale_mode: 'fit_to_page' as ScaleMode,
  custom_scale_percent: null as number | null,
  collate: true,
  notes: null as string | null,
}

export const PRINTING_PAPER_SIZE_OPTIONS: { value: PaperSize; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'a3', label: 'A3' },
  { value: 'letter', label: 'Letter' },
  { value: 'legal', label: 'Legal' },
]

export const PRINTING_PAGES_PER_SHEET_OPTIONS: PagesPerSheet[] = [1, 2, 4, 6, 9]

export const PRINTING_GENERIC_ERROR_MESSAGE = 'אירעה שגיאה. נסו שוב מאוחר יותר.'

const PRINTING_ERROR_MESSAGES: Partial<Record<PrintingErrorCode, string>> = {
  PRINT_REQUEST_TOO_LATE:
    'בקשות הדפסה יש לשלוח לפחות לפי מדיניות המוסד מראש. יש לבחור מועד מאוחר יותר.',
  PRINT_REQUEST_LOCKED: 'הטיפול בבקשה כבר התחיל ולכן לא ניתן לערוך אותה.',
  PRINT_REQUEST_FORBIDDEN: 'אין הרשאה לבצע פעולה זו.',
  PRINT_REQUEST_NOT_FOUND: 'בקשת ההדפסה לא נמצאה.',
  PRINT_REQUEST_ALREADY_CLAIMED: 'הבקשה כבר נלקחה לטיפול על ידי מזכירה אחרת.',
  PRINT_ITEM_LIMIT_EXCEEDED: `ניתן לצרף עד ${MAX_PRINT_ITEMS_PER_REQUEST} קבצים לבקשה.`,
  PRINT_FILE_TOO_LARGE: 'גודל הקובץ חייב להיות עד 50MB.',
  PRINT_FILE_TYPE_NOT_ALLOWED: 'סוג הקובץ אינו נתמך להדפסה.',
  INVALID_PRINT_SETTINGS: 'הגדרות ההדפסה אינן תקינות. בדקו את הערכים ונסו שוב.',
  INVALID_STATUS_TRANSITION: 'לא ניתן לבצע את פעולת הסטטוס המבוקשת.',
  SECRETARY_NOT_AUTHORIZED: 'אין הרשאת מזכירה לבצע פעולה זו.',
  CROSS_INSTITUTION_ACCESS_DENIED: 'לא ניתן לבצע פעולה מחוץ למוסד המורשה.',
  PRINT_FILE_NOT_AVAILABLE: 'הקובץ אינו נשמר עוד במערכת.',
}

export function mapPrintingErrorCode(code: PrintingErrorCode | string | null | undefined): string {
  if (!code) return PRINTING_GENERIC_ERROR_MESSAGE
  return PRINTING_ERROR_MESSAGES[code as PrintingErrorCode] ?? PRINTING_GENERIC_ERROR_MESSAGE
}

export function advanceNoticeHebrewMessage(minimumPrintNoticeMinutes: number): string {
  if (minimumPrintNoticeMinutes === 60) {
    return 'בקשות הדפסה יש לשלוח לפחות שעה מראש. יש לבחור מועד מאוחר יותר.'
  }
  if (minimumPrintNoticeMinutes > 0 && minimumPrintNoticeMinutes % 60 === 0) {
    const hours = minimumPrintNoticeMinutes / 60
    return `בקשות הדפסה יש לשלוח לפחות ${hours} שעות מראש. יש לבחור מועד מאוחר יותר.`
  }
  return `בקשות הדפסה יש לשלוח לפחות ${minimumPrintNoticeMinutes} דקות מראש. יש לבחור מועד מאוחר יותר.`
}

const requestStatusLabels: Record<PrintingRequestStatus, string> = {
  submitted: 'נשלחה',
  in_progress: 'בטיפול',
  needs_correction: 'דורש תיקון',
  printed: 'הודפס',
  rejected: 'נדחה',
  cancelled: 'בוטל',
}

const itemStatusLabels: Record<PrintItemStatus, string> = {
  pending: 'ממתין',
  processing: 'בטיפול',
  returned_for_correction: 'הוחזר לתיקון',
  resubmitted: 'נשלח מחדש',
  printed: 'הודפס',
  rejected: 'נדחה',
}

export function translatePrintingRequestStatus(status: PrintingRequestStatus): string {
  return requestStatusLabels[status]
}

export function translatePrintItemStatus(status: PrintItemStatus): string {
  return itemStatusLabels[status]
}

export function formatPrintingRequestNumber(requestNumber: number): string {
  return `#${requestNumber}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isPreviewablePrintFile(mimeType: string): boolean {
  const t = mimeType.toLowerCase()
  return (
    t === 'application/pdf' ||
    t === 'image/jpeg' ||
    t === 'image/png' ||
    t === 'image/webp' ||
    t === 'image/gif' ||
    t === 'image/bmp'
  )
}

export function validatePrintingFileClient(file: File): { ok: true } | { ok: false; errorMessage: string } {
  if (!file || file.size <= 0) {
    return { ok: false, errorMessage: 'הקובץ ריק או לא תקין.' }
  }
  if (file.size > MAX_PRINT_FILE_SIZE_BYTES) {
    return { ok: false, errorMessage: mapPrintingErrorCode('PRINT_FILE_TOO_LARGE') }
  }
  if (!isAllowedPrintingMimeType(file.type)) {
    // Fallback: some browsers leave type empty — check extension loosely for UX only.
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const extOk = [
      'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt',
      'ppt', 'pptx', 'odp', 'xls', 'xlsx', 'ods', 'csv',
      'jpg', 'jpeg', 'png', 'webp', 'heic', 'tiff', 'tif', 'bmp',
    ].includes(ext)
    if (!file.type && extOk) {
      return { ok: true }
    }
    return { ok: false, errorMessage: mapPrintingErrorCode('PRINT_FILE_TYPE_NOT_ALLOWED') }
  }
  return { ok: true }
}

export function guessMimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    odt: 'application/vnd.oasis.opendocument.text',
    rtf: 'application/rtf',
    txt: 'text/plain',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odp: 'application/vnd.oasis.opendocument.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    csv: 'text/csv',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    bmp: 'image/bmp',
  }
  return map[ext] ?? 'application/octet-stream'
}

export type PrintingDraftItem = {
  localId: string
  file: File | null
  previewUrl: string | null
  uploadState: 'waiting' | 'uploading' | 'uploaded' | 'failed'
  uploadError: string | null
  storageObjectPath: string | null
  original_filename: string
  detected_file_type: string
  file_size_bytes: number
  page_selection_mode: PageSelectionMode
  page_selection_value: string | null
  copies: number
  color_mode: ColorMode
  paper_size: PaperSize
  orientation: Orientation
  sides: Sides
  duplex_flip_mode: DuplexFlipMode | null
  pages_per_sheet: PagesPerSheet
  scale_mode: ScaleMode
  custom_scale_percent: number | null
  collate: boolean
  notes: string | null
  existingItemId?: string
}

export function createEmptyDraftItem(file: File): PrintingDraftItem {
  const mime = file.type || guessMimeFromFilename(file.name)
  const previewUrl = isPreviewablePrintFile(mime) ? URL.createObjectURL(file) : null
  return {
    localId: crypto.randomUUID(),
    file,
    previewUrl,
    uploadState: 'waiting',
    uploadError: null,
    storageObjectPath: null,
    original_filename: file.name,
    detected_file_type: mime,
    file_size_bytes: file.size,
    ...DEFAULT_PRINT_ITEM_SETTINGS,
  }
}

export function copySettingsFromPrevious(
  target: PrintingDraftItem,
  source: PrintingDraftItem,
): PrintingDraftItem {
  return {
    ...target,
    page_selection_mode: source.page_selection_mode,
    page_selection_value: source.page_selection_value,
    copies: source.copies,
    color_mode: source.color_mode,
    paper_size: source.paper_size,
    orientation: source.orientation,
    sides: source.sides,
    duplex_flip_mode: source.sides === 'double_sided' ? source.duplex_flip_mode : null,
    pages_per_sheet: source.pages_per_sheet,
    scale_mode: source.scale_mode,
    custom_scale_percent: source.scale_mode === 'custom' ? source.custom_scale_percent : null,
    collate: source.collate,
    // intentionally not copying file / filename / notes
  }
}

export function draftItemToInput(item: PrintingDraftItem, displayOrder: number): PrintItemInput {
  return {
    id: item.existingItemId,
    original_filename: item.original_filename,
    detected_file_type: item.detected_file_type,
    file_size_bytes: item.file_size_bytes,
    display_order: displayOrder,
    storage_object_path: item.storageObjectPath ?? undefined,
    page_selection_mode: item.page_selection_mode,
    page_selection_value: item.page_selection_value,
    copies: item.copies,
    color_mode: item.color_mode,
    paper_size: item.paper_size,
    orientation: item.orientation,
    sides: item.sides,
    duplex_flip_mode: item.sides === 'double_sided' ? item.duplex_flip_mode : null,
    pages_per_sheet: item.pages_per_sheet,
    scale_mode: item.scale_mode,
    custom_scale_percent: item.scale_mode === 'custom' ? item.custom_scale_percent : null,
    collate: item.collate,
    notes: item.notes,
  }
}

export function validateDraftItemSettings(item: PrintingDraftItem): string | null {
  if (item.page_selection_mode === 'custom') {
    if (!isValidPageSelection('custom', item.page_selection_value)) {
      return 'בחירת העמודים אינה תקינה. לדוגמה: 1-3 או 1,3,5'
    }
  }
  if (!Number.isInteger(item.copies) || item.copies < 1 || item.copies > MAX_PRINT_COPIES) {
    return `מספר העותקים חייב להיות בין 1 ל-${MAX_PRINT_COPIES}.`
  }
  if (item.sides === 'double_sided' && !item.duplex_flip_mode) {
    return 'יש לבחור היפוך בצד הארוך או הקצר להדפסה דו-צדדית.'
  }
  if (item.scale_mode === 'custom') {
    const pct = item.custom_scale_percent
    if (pct == null || !Number.isInteger(pct) || pct < 10 || pct > 400) {
      return 'אחוז ההתאמה המותאם חייב להיות בין 10 ל-400.'
    }
  }
  const code = validatePrintItemInput(draftItemToInput(item, 1))
  if (code) return mapPrintingErrorCode(code)
  return null
}

export function buildRequiredByIso(params: {
  date: string // YYYY-MM-DD
  time: string // HH:MM
  timeZone: string
}): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(params.time)
  if (!dateMatch || !timeMatch) return null
  const requiredBy = requiredByFromInstitutionLocal({
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    timeZone: params.timeZone,
  })
  return requiredBy.toISOString()
}

export function isRequiredByTooLateClient(params: {
  requiredByIso: string
  minimumPrintNoticeMinutes: number
  now?: Date
}): boolean {
  return isPrintingRequestTooLate({
    requiredBy: new Date(params.requiredByIso),
    now: params.now ?? new Date(),
    minimumPrintNoticeMinutes: params.minimumPrintNoticeMinutes,
  })
}

export function isPrintingRequestEditable(params: {
  teacherUserId: string
  actorUserId: string
  assignedSecretaryUserId: string | null
  processingStartedAt: string | null
  status: PrintingRequestStatus
}): boolean {
  return canTeacherEditOrCancel(params)
}

export const PRINTING_ACCEPTED_FILE_HINT =
  'מסמכים, מצגות, גיליונות ואלקטרוניים ותמונות · עד 50MB לקובץ · עד 10 קבצים'

export const PRINTING_ACCEPT_ATTRIBUTE = [
  ...PRINTING_ALLOWED_MIME_TYPES,
  '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt',
  '.ppt', '.pptx', '.odp',
  '.xls', '.xlsx', '.ods', '.csv',
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.tiff', '.tif', '.bmp',
].join(',')

export function formatRequiredByDisplay(iso: string, timeZone: string): { date: string; time: string } {
  const d = new Date(iso)
  const dateFmt = new Intl.DateTimeFormat('he-IL', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const timeFmt = new Intl.DateTimeFormat('he-IL', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return { date: dateFmt.format(d), time: timeFmt.format(d) }
}

export function moveDraftItem(
  items: PrintingDraftItem[],
  fromIndex: number,
  toIndex: number,
): PrintingDraftItem[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items
  }
  const next = [...items]
  const [removed] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, removed)
  return next
}
