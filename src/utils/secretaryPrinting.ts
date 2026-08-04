import type { InstitutionPrintingRequestRow } from '../services/printingRequests'
import type { PrintingRequestStatus } from '../types/printing'
import { isPrintingRequestOverdue } from '../domain/printing/validation'
import {
  formatPrintingRequestNumber,
  formatRequiredByDisplay,
} from './printingUi'

export const PRINTING_WORKSPACE_SECTION_ID = 'printingWorkspace'
export const PRINTING_WORKSPACE_NAV_LABEL = 'הדפסות'

export type PrintingWorkspaceView = 'active' | 'history'
export type PrintingDeadlineGroup = 'today' | 'tomorrow' | 'later'

export type SecretaryPrintingFilters = {
  search: string
  status: string
  assignee: 'all' | 'unassigned' | string
  deadlineGroup: 'all' | PrintingDeadlineGroup
  overdueOnly: boolean
  approachingOnly: boolean
}

export const DEFAULT_SECRETARY_PRINTING_FILTERS: SecretaryPrintingFilters = {
  search: '',
  status: 'all',
  assignee: 'all',
  deadlineGroup: 'all',
  overdueOnly: false,
  approachingOnly: false,
}

export const ACTIVE_PRINTING_STATUSES: PrintingRequestStatus[] = [
  'submitted',
  'in_progress',
  'needs_correction',
]

export const HISTORY_PRINTING_STATUSES: PrintingRequestStatus[] = [
  'printed',
  'cancelled',
  'rejected',
]

/** Updated after submission when teacher edit bumped updated_at past create. */
export function wasUpdatedAfterSubmission(row: {
  submitted_at: string
  updated_at: string
}): boolean {
  const submitted = Date.parse(row.submitted_at)
  const updated = Date.parse(row.updated_at)
  if (!Number.isFinite(submitted) || !Number.isFinite(updated)) return false
  return updated - submitted > 2000
}

export function isApproachingPrintingDeadline(params: {
  requiredBy: Date
  status: string
  now: Date
  deadlineWarningMinutes: number
}): boolean {
  if (['printed', 'rejected', 'cancelled'].includes(params.status)) return false
  if (isPrintingRequestOverdue({
    requiredBy: params.requiredBy,
    status: params.status,
    now: params.now,
  })) {
    return false
  }
  const ms = params.deadlineWarningMinutes * 60_000
  const remaining = params.requiredBy.getTime() - params.now.getTime()
  return remaining > 0 && remaining <= ms
}

/** Institution-local calendar date as YYYY-MM-DD (never browser locale date). */
export function institutionLocalDateKey(iso: string, timeZone: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

export function addCalendarDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d + days))
  const yy = utc.getUTCFullYear()
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(utc.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function getPrintingDeadlineGroup(
  requiredByIso: string,
  timeZone: string,
  now: Date = new Date(),
): PrintingDeadlineGroup {
  const requiredKey = institutionLocalDateKey(requiredByIso, timeZone)
  const todayKey = institutionLocalDateKey(now.toISOString(), timeZone)
  const tomorrowKey = addCalendarDaysToDateKey(todayKey, 1)
  if (requiredKey === todayKey) return 'today'
  if (requiredKey === tomorrowKey) return 'tomorrow'
  return 'later'
}

export function isHistoryPrintingRequest(status: string): boolean {
  return HISTORY_PRINTING_STATUSES.includes(status as PrintingRequestStatus)
}

export function isActivePrintingRequest(status: string): boolean {
  return ACTIVE_PRINTING_STATUSES.includes(status as PrintingRequestStatus)
}

export function filterSecretaryPrintingRequests(params: {
  requests: InstitutionPrintingRequestRow[]
  view: PrintingWorkspaceView
  filters: SecretaryPrintingFilters
  timeZone: string
  deadlineWarningMinutes: number
  now?: Date
}): InstitutionPrintingRequestRow[] {
  const now = params.now ?? new Date()
  const search = params.filters.search.trim().toLowerCase()

  return params.requests
    .filter((row) =>
      params.view === 'history'
        ? isHistoryPrintingRequest(row.status)
        : isActivePrintingRequest(row.status),
    )
    .filter((row) => {
      if (params.filters.status !== 'all' && row.status !== params.filters.status) return false

      if (params.filters.assignee === 'unassigned') {
        if (row.assigned_secretary_user_id) return false
      } else if (params.filters.assignee !== 'all') {
        if (row.assigned_secretary_user_id !== params.filters.assignee) return false
      }

      if (params.filters.deadlineGroup !== 'all') {
        if (
          getPrintingDeadlineGroup(row.required_by, params.timeZone, now) !==
          params.filters.deadlineGroup
        ) {
          return false
        }
      }

      const requiredBy = new Date(row.required_by)
      const overdue = isPrintingRequestOverdue({
        requiredBy,
        status: row.status,
        now,
      })
      const approaching = isApproachingPrintingDeadline({
        requiredBy,
        status: row.status,
        now,
        deadlineWarningMinutes: params.deadlineWarningMinutes,
      })

      if (params.filters.overdueOnly && !overdue) return false
      if (params.filters.approachingOnly && !approaching) return false

      if (!search) return true
      const numberLabel = formatPrintingRequestNumber(row.request_number).toLowerCase()
      const numberDigits = String(row.request_number)
      const teacher = row.teacher_full_name.toLowerCase()
      const filenames = (row.print_items ?? [])
        .map((item) => item.original_filename.toLowerCase())
        .join(' ')
      return (
        teacher.includes(search) ||
        numberLabel.includes(search) ||
        numberDigits.includes(search) ||
        filenames.includes(search)
      )
    })
    .sort((a, b) => Date.parse(a.required_by) - Date.parse(b.required_by))
}

export function groupActivePrintingRequests(params: {
  requests: InstitutionPrintingRequestRow[]
  timeZone: string
  now?: Date
}): Record<PrintingDeadlineGroup, InstitutionPrintingRequestRow[]> {
  const now = params.now ?? new Date()
  const groups: Record<PrintingDeadlineGroup, InstitutionPrintingRequestRow[]> = {
    today: [],
    tomorrow: [],
    later: [],
  }
  for (const row of params.requests) {
    groups[getPrintingDeadlineGroup(row.required_by, params.timeZone, now)].push(row)
  }
  for (const key of Object.keys(groups) as PrintingDeadlineGroup[]) {
    groups[key].sort((a, b) => Date.parse(a.required_by) - Date.parse(b.required_by))
  }
  return groups
}

export const DEADLINE_GROUP_LABELS: Record<PrintingDeadlineGroup, string> = {
  today: 'היום',
  tomorrow: 'מחר',
  later: 'בהמשך',
}

export function formatPrintItemSettingsHebrew(item: {
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
}): string[] {
  const lines: string[] = []
  if (item.page_selection_mode === 'custom' && item.page_selection_value) {
    lines.push(`עמודים ${item.page_selection_value}`)
  } else {
    lines.push('כל העמודים')
  }
  lines.push(`${item.copies} עותקים`)
  lines.push(item.color_mode === 'color' ? 'צבעוני' : 'שחור-לבן')
  lines.push(String(item.paper_size).toUpperCase())
  lines.push(item.orientation === 'landscape' ? 'לרוחב' : 'לאורך')
  if (item.sides === 'double_sided') {
    lines.push('דו-צדדי')
    if (item.duplex_flip_mode === 'long_edge') lines.push('היפוך בצד הארוך')
    if (item.duplex_flip_mode === 'short_edge') lines.push('היפוך בצד הקצר')
  } else {
    lines.push('חד-צדדי')
  }
  if (item.pages_per_sheet > 1) {
    lines.push(`${item.pages_per_sheet} עמודים בגיליון`)
  }
  if (item.scale_mode === 'fit_to_page') lines.push('התאמה לדף')
  else if (item.scale_mode === 'original_100') lines.push('100%')
  else lines.push(`${item.custom_scale_percent ?? 100}%`)
  lines.push(item.collate ? 'עותקים מאוגדים' : 'עותקים לא מאוגדים')
  return lines
}

export function describePrintingQueueRow(
  row: InstitutionPrintingRequestRow,
  timeZone: string,
): { requiredDate: string; requiredTime: string } {
  const display = formatRequiredByDisplay(row.required_by, timeZone)
  return { requiredDate: display.date, requiredTime: display.time }
}
