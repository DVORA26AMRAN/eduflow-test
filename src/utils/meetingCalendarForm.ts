import {
  MEETING_DURATIONS_MINUTES,
  MEETING_MAX_SLOTS,
  MEETING_MIN_SLOTS,
  type MeetingDurationMinutes,
  type ProposedMeetingSlotInput,
} from '../types/meetingCalendar'
import { isMeetingDurationMinutes, validateProposedMeetingSlots } from './meetingCalendar'
import {
  MEETING_REASON_MAX_LENGTH,
  MEETING_SUBJECT_MAX_LENGTH,
} from './meetingCalendarDisplay'

export type CreateMeetingFormFields = {
  recipientId: string
  subject: string
  reason: string
  durationMinutes: number | null
  requireDuration: boolean
}

export type SlotDraft = {
  id: string
  date: string
  startTime: string
}

export type CreateMeetingFormValidation =
  | {
      ok: true
      subject: string
      reason: string
      durationMinutes: MeetingDurationMinutes | null
    }
  | { ok: false; errorMessage: string }

export function validateCreateMeetingForm(
  fields: CreateMeetingFormFields,
): CreateMeetingFormValidation {
  if (!fields.recipientId.trim()) {
    return { ok: false, errorMessage: 'נא לבחור נמען.' }
  }

  const subject = fields.subject.trim()
  if (!subject) {
    return { ok: false, errorMessage: 'נא להזין נושא.' }
  }
  if (subject.length > MEETING_SUBJECT_MAX_LENGTH) {
    return {
      ok: false,
      errorMessage: `נושא הפגישה מוגבל ל־${MEETING_SUBJECT_MAX_LENGTH} תווים.`,
    }
  }

  const reason = fields.reason.trim()
  if (!reason) {
    return { ok: false, errorMessage: 'נא להזין סיבה.' }
  }
  if (reason.length > MEETING_REASON_MAX_LENGTH) {
    return {
      ok: false,
      errorMessage: `סיבת הפגישה מוגבלת ל־${MEETING_REASON_MAX_LENGTH} תווים.`,
    }
  }

  if (fields.requireDuration) {
    if (fields.durationMinutes === null || !isMeetingDurationMinutes(fields.durationMinutes)) {
      return { ok: false, errorMessage: 'נא לבחור משך פגישה חוקי.' }
    }
    return { ok: true, subject, reason, durationMinutes: fields.durationMinutes }
  }

  return { ok: true, subject, reason, durationMinutes: null }
}

export function buildSlotEndsAt(startsAtIso: string, durationMinutes: MeetingDurationMinutes): string {
  const start = new Date(startsAtIso)
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  return end.toISOString()
}

export function draftSlotsToProposedInputs(
  drafts: SlotDraft[],
  durationMinutes: MeetingDurationMinutes,
): { ok: true; slots: ProposedMeetingSlotInput[] } | { ok: false; errorMessage: string } {
  if (drafts.length < MEETING_MIN_SLOTS) {
    return { ok: false, errorMessage: 'יש להוסיף לפחות מועד אחד.' }
  }
  if (drafts.length > MEETING_MAX_SLOTS) {
    return { ok: false, errorMessage: `ניתן להציע עד ${MEETING_MAX_SLOTS} מועדים.` }
  }

  const slots: ProposedMeetingSlotInput[] = []

  for (const draft of drafts) {
    if (!draft.date.trim() || !draft.startTime.trim()) {
      return { ok: false, errorMessage: 'כל מועד חייב לכלול תאריך ושעת התחלה.' }
    }

    const startsAt = new Date(`${draft.date}T${draft.startTime}:00`)
    if (Number.isNaN(startsAt.getTime())) {
      return { ok: false, errorMessage: 'תאריך או שעה אינם תקינים.' }
    }

    slots.push({
      startsAt: startsAt.toISOString(),
      endsAt: buildSlotEndsAt(startsAt.toISOString(), durationMinutes),
    })
  }

  const validationError = validateProposedMeetingSlots({ slots, durationMinutes })
  if (validationError) {
    return { ok: false, errorMessage: validationError }
  }

  return { ok: true, slots }
}

export function createEmptySlotDraft(): SlotDraft {
  return {
    id: `slot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    date: '',
    startTime: '',
  }
}

export const MEETING_DURATION_OPTIONS: MeetingDurationMinutes[] = [...MEETING_DURATIONS_MINUTES]
