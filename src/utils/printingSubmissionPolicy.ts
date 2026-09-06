import type { PrintSubmissionPolicyMode } from '../types/printing'

export const PRINTING_RELATIVE_NOTICE_PRESETS = [30, 60, 120, 180, 1440] as const

export type PrintingRelativeNoticePreset = (typeof PRINTING_RELATIVE_NOTICE_PRESETS)[number]

export type PrintingSubmissionPolicyUiChoice =
  | { kind: 'preset'; minutes: PrintingRelativeNoticePreset }
  | { kind: 'custom'; hours: number; minutes: number }
  | { kind: 'daily_cutoff'; localTime: string }

export type PrintingSubmissionPolicySavedState = {
  mode: PrintSubmissionPolicyMode
  noticeMinutes: number
  cutoffLocalTime: string | null
  timeZone: string
}

export const PRINTING_SUBMISSION_POLICY_QUESTION =
  'כמה זמן מראש מורות צריכות לשלוח להדפסה?'

export const PRINTING_DAILY_CUTOFF_EXPLANATION =
  'לאחר שעה זו לא ניתן לשלוח בקשת הדפסה להיום.'

export const PRINTING_SUBMISSION_POLICY_PRESET_LABELS: Record<
  PrintingRelativeNoticePreset,
  string
> = {
  30: '30 דקות מראש',
  60: 'שעה מראש',
  120: 'שעתיים מראש',
  180: '3 שעות מראש',
  1440: 'יום מראש',
}

export function isPrintingRelativeNoticePreset(
  minutes: number,
): minutes is PrintingRelativeNoticePreset {
  return (PRINTING_RELATIVE_NOTICE_PRESETS as readonly number[]).includes(minutes)
}

/** Normalize DB TIME text (e.g. 08:00:00) to HH:MM for <input type="time">. */
export function normalizePrintingCutoffLocalTimeForInput(
  value: string | null | undefined,
): string {
  if (!value?.trim()) return ''
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim())
  if (!match) return ''
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return ''
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Normalize HH:MM or HH:MM:SS to HH:MM:SS for RPC TIME. */
export function normalizePrintingCutoffLocalTimeForRpc(
  value: string | null | undefined,
): string | null {
  const hhmm = normalizePrintingCutoffLocalTimeForInput(value)
  if (!hhmm) return null
  return `${hhmm}:00`
}

export function reconstructPrintingSubmissionPolicyChoice(
  saved: Pick<PrintingSubmissionPolicySavedState, 'mode' | 'noticeMinutes' | 'cutoffLocalTime'>,
): PrintingSubmissionPolicyUiChoice {
  if (saved.mode === 'daily_cutoff') {
    return {
      kind: 'daily_cutoff',
      localTime: normalizePrintingCutoffLocalTimeForInput(saved.cutoffLocalTime) || '08:00',
    }
  }
  if (isPrintingRelativeNoticePreset(saved.noticeMinutes)) {
    return { kind: 'preset', minutes: saved.noticeMinutes }
  }
  const hours = Math.floor(saved.noticeMinutes / 60)
  const minutes = saved.noticeMinutes % 60
  return { kind: 'custom', hours, minutes }
}

export function customRelativeNoticeTotalMinutes(hours: number, minutes: number): number {
  return hours * 60 + minutes
}

export function validateCustomRelativeNoticeMinutes(
  hours: number,
  minutes: number,
): string | null {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return 'יש להזין מספרים שלמים לשעות ולדקות.'
  }
  if (hours < 0 || minutes < 0 || minutes > 59) {
    return 'ערכי השעות והדקות אינם תקינים.'
  }
  const total = customRelativeNoticeTotalMinutes(hours, minutes)
  if (total < 0 || total > 10080) {
    return 'ניתן להגדיר בין 0 דקות ל־7 ימים מראש.'
  }
  return null
}

export function buildPrintingSubmissionPolicySavePayload(params: {
  choice: PrintingSubmissionPolicyUiChoice
  /** Preserved notice when switching to daily_cutoff (architecture: stay NOT NULL). */
  preservedNoticeMinutes: number
}):
  | {
      ok: true
      printSubmissionPolicyMode: PrintSubmissionPolicyMode
      minimumPrintNoticeMinutes: number
      printDailyCutoffLocalTime: string | null
    }
  | { ok: false; errorMessage: string } {
  if (params.choice.kind === 'preset') {
    return {
      ok: true,
      printSubmissionPolicyMode: 'relative_notice',
      minimumPrintNoticeMinutes: params.choice.minutes,
      printDailyCutoffLocalTime: null,
    }
  }

  if (params.choice.kind === 'custom') {
    const validationError = validateCustomRelativeNoticeMinutes(
      params.choice.hours,
      params.choice.minutes,
    )
    if (validationError) return { ok: false, errorMessage: validationError }
    return {
      ok: true,
      printSubmissionPolicyMode: 'relative_notice',
      minimumPrintNoticeMinutes: customRelativeNoticeTotalMinutes(
        params.choice.hours,
        params.choice.minutes,
      ),
      printDailyCutoffLocalTime: null,
    }
  }

  const cutoff = normalizePrintingCutoffLocalTimeForRpc(params.choice.localTime)
  if (!cutoff) {
    return { ok: false, errorMessage: 'יש לבחור שעת חתך תקינה.' }
  }

  const preserved = params.preservedNoticeMinutes
  if (!Number.isInteger(preserved) || preserved < 0 || preserved > 10080) {
    return { ok: false, errorMessage: 'הגדרות ההדפסה אינן תקינות. בדקו את הערכים ונסו שוב.' }
  }

  return {
    ok: true,
    printSubmissionPolicyMode: 'daily_cutoff',
    minimumPrintNoticeMinutes: preserved,
    printDailyCutoffLocalTime: cutoff,
  }
}

export function printingSubmissionPolicyChoicesEqual(
  a: PrintingSubmissionPolicyUiChoice,
  b: PrintingSubmissionPolicyUiChoice,
): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'preset' && b.kind === 'preset') return a.minutes === b.minutes
  if (a.kind === 'custom' && b.kind === 'custom') {
    return a.hours === b.hours && a.minutes === b.minutes
  }
  if (a.kind === 'daily_cutoff' && b.kind === 'daily_cutoff') {
    return (
      normalizePrintingCutoffLocalTimeForInput(a.localTime) ===
      normalizePrintingCutoffLocalTimeForInput(b.localTime)
    )
  }
  return false
}
