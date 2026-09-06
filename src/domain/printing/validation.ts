import {
  MAX_PRINT_COPIES,
  MAX_PRINT_FILE_SIZE_BYTES,
  MAX_PRINT_ITEMS_PER_REQUEST,
  MIN_PRINT_ITEMS_PER_REQUEST,
  PRINTING_ALLOWED_MIME_TYPES,
  type ColorMode,
  type Orientation,
  type PageSelectionMode,
  type PagesPerSheet,
  type PaperSize,
  type PrintItemInput,
  type PrintSubmissionPolicyMode,
  type PrintingErrorCode,
  type ScaleMode,
  type Sides,
} from '../../types/printing'

const PAGES_PER_SHEET: readonly PagesPerSheet[] = [1, 2, 4, 6, 9]
const COLOR_MODES: readonly ColorMode[] = ['black_and_white', 'color']
const ORIENTATIONS: readonly Orientation[] = ['portrait', 'landscape']
const SIDES: readonly Sides[] = ['single_sided', 'double_sided']
const SCALE_MODES: readonly ScaleMode[] = ['fit_to_page', 'original_100', 'custom']
const PAPER_SIZES: readonly PaperSize[] = ['a4', 'a3', 'letter', 'legal']

export function isAllowedPrintingMimeType(mime: string): boolean {
  const normalized = mime.trim().toLowerCase()
  return (PRINTING_ALLOWED_MIME_TYPES as readonly string[]).includes(normalized)
}

/**
 * Validates custom page selection strings such as "1-3", "1,3,5", "2-4,7".
 * Mode "all" requires empty/null value.
 */
export function isValidPageSelection(
  mode: PageSelectionMode,
  value: string | null | undefined,
): boolean {
  if (mode === 'all') {
    return value == null || value.trim() === ''
  }
  if (mode !== 'custom') return false
  const raw = value?.trim() ?? ''
  if (!raw) return false
  if (!/^[0-9,-]+$/.test(raw)) return false

  for (const token of raw.split(',')) {
    const part = token.trim()
    if (!part) return false
    if (/^\d+$/.test(part)) {
      if (Number(part) < 1) return false
      continue
    }
    const range = part.match(/^(\d+)-(\d+)$/)
    if (!range) return false
    const left = Number(range[1])
    const right = Number(range[2])
    if (left < 1 || right < 1 || left > right) return false
  }
  return true
}

export function validatePrintItemInput(item: PrintItemInput): PrintingErrorCode | null {
  if (!item.original_filename?.trim()) return 'INVALID_PRINT_SETTINGS'
  if (!Number.isFinite(item.file_size_bytes) || item.file_size_bytes <= 0) {
    return 'INVALID_PRINT_SETTINGS'
  }
  if (item.file_size_bytes > MAX_PRINT_FILE_SIZE_BYTES) return 'PRINT_FILE_TOO_LARGE'
  if (!isAllowedPrintingMimeType(item.detected_file_type)) {
    return 'PRINT_FILE_TYPE_NOT_ALLOWED'
  }

  const copies = item.copies ?? 1
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_PRINT_COPIES) {
    return 'INVALID_PRINT_SETTINGS'
  }

  const color = item.color_mode ?? 'black_and_white'
  if (!COLOR_MODES.includes(color)) return 'INVALID_PRINT_SETTINGS'

  const orientation = item.orientation ?? 'portrait'
  if (!ORIENTATIONS.includes(orientation)) return 'INVALID_PRINT_SETTINGS'

  const sides = item.sides ?? 'single_sided'
  if (!SIDES.includes(sides)) return 'INVALID_PRINT_SETTINGS'
  if (sides === 'double_sided') {
    if (item.duplex_flip_mode !== 'long_edge' && item.duplex_flip_mode !== 'short_edge') {
      return 'INVALID_PRINT_SETTINGS'
    }
  } else if (item.duplex_flip_mode != null) {
    return 'INVALID_PRINT_SETTINGS'
  }

  const pps = (item.pages_per_sheet ?? 1) as PagesPerSheet
  if (!PAGES_PER_SHEET.includes(pps)) return 'INVALID_PRINT_SETTINGS'

  const scale = item.scale_mode ?? 'fit_to_page'
  if (!SCALE_MODES.includes(scale)) return 'INVALID_PRINT_SETTINGS'
  if (scale === 'custom') {
    const pct = item.custom_scale_percent
    if (pct == null || !Number.isInteger(pct) || pct < 10 || pct > 400) {
      return 'INVALID_PRINT_SETTINGS'
    }
  } else if (item.custom_scale_percent != null) {
    return 'INVALID_PRINT_SETTINGS'
  }

  const pageMode = item.page_selection_mode ?? 'all'
  if (pageMode !== 'all' && pageMode !== 'custom') return 'INVALID_PRINT_SETTINGS'
  if (!isValidPageSelection(pageMode, item.page_selection_value)) {
    return 'INVALID_PRINT_SETTINGS'
  }

  const paper = item.paper_size ?? 'a4'
  if (!PAPER_SIZES.includes(paper)) return 'INVALID_PRINT_SETTINGS'

  return null
}

export function validatePrintItemCount(count: number): PrintingErrorCode | null {
  if (!Number.isInteger(count) || count < MIN_PRINT_ITEMS_PER_REQUEST) {
    return 'INVALID_PRINT_SETTINGS'
  }
  if (count > MAX_PRINT_ITEMS_PER_REQUEST) return 'PRINT_ITEM_LIMIT_EXCEEDED'
  return null
}

/**
 * Advance-notice cutoff using absolute instants.
 * Callers must construct `requiredBy` from institution-local wall time + institution timezone
 * (never browser timezone). Interval length is independent of DST once both sides are UTC.
 */
export function isPrintingRequestTooLate(params: {
  requiredBy: Date
  now: Date
  minimumPrintNoticeMinutes: number
}): boolean {
  const cutoffMs =
    params.requiredBy.getTime() - params.minimumPrintNoticeMinutes * 60_000
  return params.now.getTime() > cutoffMs
}

/**
 * Build a required_by Date from institution-local components.
 * Uses Intl to resolve the correct UTC instant for the institution timezone,
 * including DST transitions.
 */
export function requiredByFromInstitutionLocal(params: {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  timeZone: string
}): Date {
  const { year, month, day, hour, minute, timeZone } = params
  const roughUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  const partsAsUtcGuess = Object.fromEntries(
    dtf.formatToParts(roughUtc).map((p) => [p.type, p.value]),
  ) as Record<string, string>

  const asIfLocal = Date.UTC(
    Number(partsAsUtcGuess.year),
    Number(partsAsUtcGuess.month) - 1,
    Number(partsAsUtcGuess.day),
    Number(partsAsUtcGuess.hour),
    Number(partsAsUtcGuess.minute),
    Number(partsAsUtcGuess.second),
  )

  const offset = asIfLocal - roughUtc.getTime()
  return new Date(roughUtc.getTime() - offset)
}

export function isPrintingRequestOverdue(params: {
  requiredBy: Date
  status: string
  now: Date
}): boolean {
  if (['printed', 'rejected', 'cancelled'].includes(params.status)) return false
  return params.now.getTime() > params.requiredBy.getTime()
}

/** Parse HH:MM or HH:MM:SS into seconds since local midnight. */
export function parseLocalTimeToSeconds(localTime: string): number | null {
  const trimmed = localTime.trim()
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = match[3] != null ? Number(match[3]) : 0
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null
  }
  return hour * 3600 + minute * 60 + second
}

export function getInstitutionLocalDateTimeParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value])) as Record<
    string,
    string
  >
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

function localDateKey(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

/**
 * Daily-cutoff same-day gate (UX/domain mirror of SQL).
 * Exact local cutoff time is allowed; strictly after closes today's local date.
 */
export function isPrintingSameDayClosed(params: {
  requiredBy: Date
  now: Date
  timeZone: string
  dailyCutoffLocalTime: string
}): boolean {
  const cutoffSeconds = parseLocalTimeToSeconds(params.dailyCutoffLocalTime)
  if (cutoffSeconds == null) return true

  const nowLocal = getInstitutionLocalDateTimeParts(params.now, params.timeZone)
  const requiredLocal = getInstitutionLocalDateTimeParts(params.requiredBy, params.timeZone)
  const nowSeconds = nowLocal.hour * 3600 + nowLocal.minute * 60 + nowLocal.second

  if (nowSeconds <= cutoffSeconds) return false
  return localDateKey(requiredLocal) === localDateKey(nowLocal)
}

/**
 * Mirrors printing_validate_required_by policy branching (relative XOR daily).
 * Client UX only — PostgreSQL remains authoritative.
 */
export function evaluatePrintingSubmissionPolicy(params: {
  mode: PrintSubmissionPolicyMode
  requiredBy: Date
  now: Date
  minimumPrintNoticeMinutes: number
  timeZone: string
  dailyCutoffLocalTime: string | null
}): PrintingErrorCode | null {
  if (params.mode === 'relative_notice') {
    return isPrintingRequestTooLate({
      requiredBy: params.requiredBy,
      now: params.now,
      minimumPrintNoticeMinutes: params.minimumPrintNoticeMinutes,
    })
      ? 'PRINT_REQUEST_TOO_LATE'
      : null
  }

  if (params.mode === 'daily_cutoff') {
    if (!params.dailyCutoffLocalTime) return 'INVALID_PRINT_SETTINGS'
    if (params.requiredBy.getTime() < params.now.getTime()) {
      return 'PRINT_REQUEST_TOO_LATE'
    }
    if (
      isPrintingSameDayClosed({
        requiredBy: params.requiredBy,
        now: params.now,
        timeZone: params.timeZone,
        dailyCutoffLocalTime: params.dailyCutoffLocalTime,
      })
    ) {
      return 'PRINT_REQUEST_SAME_DAY_CLOSED'
    }
    return null
  }

  return 'INVALID_PRINT_SETTINGS'
}
