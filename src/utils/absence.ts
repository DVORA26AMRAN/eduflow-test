import type { AbsenceReason, AbsenceRequestPayload } from '../types/request'

export const ABSENCE_REASON_OPTIONS: { value: AbsenceReason; label: string }[] = [
  { value: 'sick_leave', label: 'אישור מחלה' },
  { value: 'child_sickness', label: 'מחלת ילד' },
  { value: 'pregnancy_hours', label: 'שעות הריון' },
  { value: 'other', label: 'אחר' },
]

const absenceReasonLabels: Record<AbsenceReason, string> = {
  sick_leave: 'אישור מחלה',
  child_sickness: 'מחלת ילד',
  pregnancy_hours: 'שעות הריון',
  other: 'אחר',
}

export type AbsenceFormFields = {
  absenceDate: string
  absenceReason: AbsenceReason | ''
  absenceReasonOther: string
  replacedBy: string
}

export type ValidateAbsenceFormResult =
  | { ok: true; payload: AbsenceRequestPayload }
  | { ok: false; errorMessage: string }

export function isAbsenceReason(value: string): value is AbsenceReason {
  return (
    value === 'sick_leave' ||
    value === 'child_sickness' ||
    value === 'pregnancy_hours' ||
    value === 'other'
  )
}

export function translateAbsenceReason(reason: AbsenceReason): string {
  return absenceReasonLabels[reason]
}

function formatAbsenceDateLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return isoDate
  }

  return date.toLocaleDateString('he-IL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function buildAbsenceRequestPayload(fields: AbsenceFormFields): AbsenceRequestPayload {
  const replacedBy = fields.replacedBy.trim()

  return {
    absence_date: fields.absenceDate,
    absence_reason: fields.absenceReason as AbsenceReason,
    absence_reason_other:
      fields.absenceReason === 'other' ? fields.absenceReasonOther.trim() : null,
    replaced_by: replacedBy.length > 0 ? replacedBy : null,
  }
}

export function buildAbsenceDescription(payload: AbsenceRequestPayload): string {
  const lines = [
    `בקשת היעדרות ליום ${formatAbsenceDateLabel(payload.absence_date)}`,
    `סיבה: ${translateAbsenceReason(payload.absence_reason)}`,
  ]

  if (payload.absence_reason === 'other' && payload.absence_reason_other) {
    lines.push(`פירוט: ${payload.absence_reason_other}`)
  }

  if (payload.replaced_by) {
    lines.push(`מחליפה: ${payload.replaced_by}`)
  }

  return lines.join('\n')
}

export function validateAbsenceForm(fields: AbsenceFormFields): ValidateAbsenceFormResult {
  if (!fields.absenceDate) {
    return {
      ok: false,
      errorMessage: 'נא לבחור תאריך היעדרות.',
    }
  }

  if (!fields.absenceReason || !isAbsenceReason(fields.absenceReason)) {
    return {
      ok: false,
      errorMessage: 'נא לבחור סיבת היעדרות.',
    }
  }

  if (fields.absenceReason === 'other' && !fields.absenceReasonOther.trim()) {
    return {
      ok: false,
      errorMessage: 'נא להזין פירוט סיבה אחרת.',
    }
  }

  return {
    ok: true,
    payload: buildAbsenceRequestPayload(fields),
  }
}
