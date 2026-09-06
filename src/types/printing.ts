/**
 * MPEX Printing Requests — Phase 1 typed contracts.
 * Business rules live server-side; this module mirrors validation for clients/tests.
 */

export const PRINTING_FILES_BUCKET = 'printing-files' as const

/** Maximum size per uploaded print file (50 MB). */
export const MAX_PRINT_FILE_SIZE_BYTES = 50 * 1024 * 1024

/** Maximum Print Items on one Printing Request. */
export const MAX_PRINT_ITEMS_PER_REQUEST = 10

/** Minimum Print Items on one Printing Request. */
export const MIN_PRINT_ITEMS_PER_REQUEST = 1

/**
 * Upper bound for copies per Print Item (Phase 1 engineering limit).
 * Documented before Phase 1 approval: positive integer, max 500.
 */
export const MAX_PRINT_COPIES = 500

export const DEFAULT_FILE_RETENTION_DAYS = 90

export type PrintingRequestStatus =
  | 'submitted'
  | 'in_progress'
  | 'needs_correction'
  | 'printed'
  | 'rejected'
  | 'cancelled'

export type PrintItemStatus =
  | 'pending'
  | 'processing'
  | 'returned_for_correction'
  | 'resubmitted'
  | 'printed'
  | 'rejected'

export type PageSelectionMode = 'all' | 'custom'
export type ColorMode = 'black_and_white' | 'color'
export type Orientation = 'portrait' | 'landscape'
export type Sides = 'single_sided' | 'double_sided'
export type DuplexFlipMode = 'long_edge' | 'short_edge'
export type PagesPerSheet = 1 | 2 | 4 | 6 | 9
export type ScaleMode = 'fit_to_page' | 'original_100' | 'custom'
export type PaperSize = 'a4' | 'a3' | 'letter' | 'legal'

export type PrintSubmissionPolicyMode = 'relative_notice' | 'daily_cutoff'

export type PrintingErrorCode =
  | 'PRINT_REQUEST_TOO_LATE'
  | 'PRINT_REQUEST_SAME_DAY_CLOSED'
  | 'PRINT_REQUEST_LOCKED'
  | 'PRINT_REQUEST_NOT_FOUND'
  | 'PRINT_REQUEST_FORBIDDEN'
  | 'PRINT_REQUEST_UNKNOWN_ERROR'
  | 'PRINT_REQUEST_ALREADY_CLAIMED'
  | 'PRINT_ITEM_LIMIT_EXCEEDED'
  | 'PRINT_FILE_TOO_LARGE'
  | 'PRINT_FILE_TYPE_NOT_ALLOWED'
  | 'INVALID_PRINT_SETTINGS'
  | 'INVALID_STATUS_TRANSITION'
  | 'SECRETARY_NOT_AUTHORIZED'
  | 'CROSS_INSTITUTION_ACCESS_DENIED'
  | 'PRINT_FILE_NOT_AVAILABLE'
  | 'PRINT_ITEM_NOT_RETURNED'
  | 'PRINT_ITEM_CORRECTION_FORBIDDEN'
  | 'PRINT_ITEM_RESUBMISSION_INVALID'
  | 'PRINT_FILE_REPLACEMENT_FAILED'
  | 'PRINT_NOTIFICATION_ALREADY_EMITTED'
  | 'PRINT_RETENTION_NOT_ELIGIBLE'
  | 'PRINT_FILE_ALREADY_PURGED'
  | 'PRINT_RETENTION_DELETE_FAILED'

export const PRINTING_ERROR_CODES: readonly PrintingErrorCode[] = [
  'PRINT_REQUEST_TOO_LATE',
  'PRINT_REQUEST_SAME_DAY_CLOSED',
  'PRINT_REQUEST_LOCKED',
  'PRINT_REQUEST_NOT_FOUND',
  'PRINT_REQUEST_FORBIDDEN',
  'PRINT_REQUEST_UNKNOWN_ERROR',
  'PRINT_REQUEST_ALREADY_CLAIMED',
  'PRINT_ITEM_LIMIT_EXCEEDED',
  'PRINT_FILE_TOO_LARGE',
  'PRINT_FILE_TYPE_NOT_ALLOWED',
  'INVALID_PRINT_SETTINGS',
  'INVALID_STATUS_TRANSITION',
  'SECRETARY_NOT_AUTHORIZED',
  'CROSS_INSTITUTION_ACCESS_DENIED',
  'PRINT_FILE_NOT_AVAILABLE',
  'PRINT_ITEM_NOT_RETURNED',
  'PRINT_ITEM_CORRECTION_FORBIDDEN',
  'PRINT_ITEM_RESUBMISSION_INVALID',
  'PRINT_FILE_REPLACEMENT_FAILED',
  'PRINT_NOTIFICATION_ALREADY_EMITTED',
  'PRINT_RETENTION_NOT_ELIGIBLE',
  'PRINT_FILE_ALREADY_PURGED',
  'PRINT_RETENTION_DELETE_FAILED',
] as const

export function isPrintingErrorCode(value: unknown): value is PrintingErrorCode {
  return typeof value === 'string' && (PRINTING_ERROR_CODES as readonly string[]).includes(value)
}

/** Centrally maintainable allow-list (MIME). Extensions alone are never authoritative. */
export const PRINTING_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/plain',
  'text/rtf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/bmp',
] as const

export type PrintingAllowedMimeType = (typeof PRINTING_ALLOWED_MIME_TYPES)[number]

/** Extension hints for UX / sniffing assistance — not sole validation. */
export const PRINTING_ALLOWED_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'txt',
  'ppt',
  'pptx',
  'odp',
  'xls',
  'xlsx',
  'ods',
  'csv',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'tiff',
  'tif',
  'bmp',
] as const

export type PrintItemInput = {
  id?: string
  original_filename: string
  detected_file_type: string
  file_size_bytes: number
  display_order?: number
  storage_object_path?: string
  page_selection_mode?: PageSelectionMode
  page_selection_value?: string | null
  copies?: number
  color_mode?: ColorMode
  paper_size?: PaperSize
  orientation?: Orientation
  sides?: Sides
  duplex_flip_mode?: DuplexFlipMode | null
  pages_per_sheet?: PagesPerSheet
  scale_mode?: ScaleMode
  custom_scale_percent?: number | null
  collate?: boolean
  notes?: string | null
}

export type InstitutionPrintingSettings = {
  minimum_print_notice_minutes: number
  deadline_warning_minutes: number
  file_retention_days: number
  timezone: string
  print_submission_policy_mode: PrintSubmissionPolicyMode
  print_daily_cutoff_local_time: string | null
}

export type PrintingRpcResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error_code: PrintingErrorCode }

/** Backend command names (Supabase RPCs). */
export const PRINTING_RPC = {
  createRequest: 'printing_create_request',
  updateRequest: 'printing_update_request',
  cancelRequest: 'printing_cancel_request',
  claimRequest: 'printing_claim_request',
  releaseRequest: 'printing_release_request',
  transferRequest: 'printing_transfer_request',
  returnItemForCorrection: 'printing_return_item_for_correction',
  resubmitItem: 'printing_resubmit_item',
  rejectItem: 'printing_reject_item',
  markItemPrinted: 'printing_mark_item_printed',
  updateInstitutionSettings: 'printing_update_institution_settings',
  validateRequiredBy: 'printing_validate_required_by',
  deriveParentStatus: 'printing_derive_parent_status',
} as const
