/**
 * Phase 5 meeting reminder rules (mirrors SQL schedule function).
 * Backend owns generation; this module documents and unit-tests the rules.
 */

export type MeetingReminderKind = '24h' | '1h'

export type MeetingReminderSchedulePlan = {
  kinds: MeetingReminderKind[]
  skippedReason: 'less_than_1h' | 'less_than_24h' | null
  scheduledFor: Partial<Record<MeetingReminderKind, Date>>
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * Decide which reminders to create for a confirmed slot.
 * @param startsAt confirmed slot start
 * @param referenceNow confirmation / schedule reference time
 */
export function planMeetingReminders(
  startsAt: Date,
  referenceNow: Date = new Date(),
): MeetingReminderSchedulePlan {
  const leadMs = startsAt.getTime() - referenceNow.getTime()

  if (leadMs < HOUR_MS) {
    return { kinds: [], skippedReason: 'less_than_1h', scheduledFor: {} }
  }

  const scheduledFor: Partial<Record<MeetingReminderKind, Date>> = {
    '1h': new Date(startsAt.getTime() - HOUR_MS),
  }
  const kinds: MeetingReminderKind[] = ['1h']

  if (leadMs >= DAY_MS) {
    kinds.unshift('24h')
    scheduledFor['24h'] = new Date(startsAt.getTime() - DAY_MS)
    return { kinds, skippedReason: null, scheduledFor }
  }

  return { kinds, skippedReason: 'less_than_24h', scheduledFor }
}

export function buildMeetingReminderNotificationCopy(kind: MeetingReminderKind): {
  title: string
  message: string
} {
  if (kind === '24h') {
    return {
      title: 'תזכורת לפגישה — בעוד 24 שעות',
      message: 'פגישה מאושרת תתקיים בעוד כ־24 שעות.',
    }
  }

  return {
    title: 'תזכורת לפגישה — בעוד שעה',
    message: 'פגישה מאושרת תתקיים בעוד כשעה.',
  }
}

/**
 * Reschedule regeneration: cancel previous slot pending reminders, then plan for new slot.
 * During reschedule overlay (before final confirm), previous reminders are kept.
 */
export function planReminderRegenerationAfterRescheduleConfirm(input: {
  previousSlotId: string | null
  newSlotStartsAt: Date
  referenceNow?: Date
}): {
  cancelPreviousSlotReminders: boolean
  previousSlotId: string | null
  schedule: MeetingReminderSchedulePlan
} {
  return {
    cancelPreviousSlotReminders: Boolean(input.previousSlotId),
    previousSlotId: input.previousSlotId,
    schedule: planMeetingReminders(input.newSlotStartsAt, input.referenceNow ?? new Date()),
  }
}

export function shouldKeepRemindersDuringRescheduleOverlay(): boolean {
  return true
}

export function shouldCancelAllPendingRemindersOnMeetingCancel(): boolean {
  return true
}

/** Unique key used for duplicate protection (meeting + slot + kind). */
export function meetingReminderDedupKey(
  meetingId: string,
  slotId: string,
  kind: MeetingReminderKind,
): string {
  return `${meetingId}:${slotId}:${kind}`
}
