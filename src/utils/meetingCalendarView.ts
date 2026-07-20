import type { Meeting, MeetingCalendarRole, MeetingSlot } from '../types/meetingCalendar'
import {
  classifyMeetingPendingBucket,
  type MeetingPendingBucket,
  type MeetingUserDirectoryEntry,
} from './meetingCalendarDisplay'

export type CalendarViewMode = 'month' | 'week'

export type CalendarDayCell = {
  date: Date
  dateKey: string
  inCurrentMonth: boolean
  isToday: boolean
}

export type ConfirmedCalendarEvent = {
  meetingId: string
  subject: string
  reason: string
  durationMinutes: number | null
  status: Meeting['currentState']
  startsAt: string
  endsAt: string
  timeZone: string
  participantId: string
  participantName: string
  participantRole: MeetingCalendarRole | null
}

export type MeetingPhase3PanelId =
  | 'waiting_for_my_approval'
  | 'waiting_for_me_to_propose'
  | 'waiting_for_me_to_choose'
  | 'waiting_for_my_final_confirmation'
  | 'upcoming'

export const MEETING_PHASE3_PANEL_ORDER: MeetingPhase3PanelId[] = [
  'waiting_for_my_approval',
  'waiting_for_me_to_propose',
  'waiting_for_me_to_choose',
  'waiting_for_my_final_confirmation',
  'upcoming',
]

const PHASE3_PANEL_LABELS: Record<MeetingPhase3PanelId, string> = {
  waiting_for_my_approval: 'ממתין לאישור שלי',
  waiting_for_me_to_propose: 'ממתין להצעת מועדים ממני',
  waiting_for_me_to_choose: 'ממתין לבחירת מועד ממני',
  waiting_for_my_final_confirmation: 'ממתין לאישור סופי ממני',
  upcoming: 'פגישות קרובות',
}

const WEEKDAY_LABELS_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const

export function translateMeetingPhase3Panel(panelId: MeetingPhase3PanelId): string {
  return PHASE3_PANEL_LABELS[panelId]
}

export function getMeetingCalendarWeekdayLabels(): readonly string[] {
  return WEEKDAY_LABELS_HE
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

export function startOfWeekSunday(date: Date): Date {
  const start = startOfDay(date)
  return addDays(start, -start.getDay())
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dateKeyFromIso(iso: string, timeZone = 'Asia/Jerusalem'): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date(iso))
}

export function getVisibleCalendarRange(
  anchorDate: Date,
  viewMode: CalendarViewMode,
): { rangeStart: Date; rangeEnd: Date } {
  if (viewMode === 'week') {
    const rangeStart = startOfWeekSunday(anchorDate)
    return { rangeStart, rangeEnd: addDays(rangeStart, 7) }
  }

  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
  const rangeStart = startOfWeekSunday(monthStart)
  const monthEnd = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0)
  const lastCell = addDays(startOfWeekSunday(monthEnd), 6)
  return { rangeStart, rangeEnd: addDays(lastCell, 1) }
}

export function buildMonthDayCells(anchorDate: Date, today = new Date()): CalendarDayCell[] {
  const { rangeStart, rangeEnd } = getVisibleCalendarRange(anchorDate, 'month')
  const cells: CalendarDayCell[] = []
  const todayKey = toDateKey(startOfDay(today))

  for (let cursor = rangeStart; cursor < rangeEnd; cursor = addDays(cursor, 1)) {
    cells.push({
      date: cursor,
      dateKey: toDateKey(cursor),
      inCurrentMonth: cursor.getMonth() === anchorDate.getMonth(),
      isToday: toDateKey(cursor) === todayKey,
    })
  }

  return cells
}

export function buildWeekDayCells(anchorDate: Date, today = new Date()): CalendarDayCell[] {
  const { rangeStart } = getVisibleCalendarRange(anchorDate, 'week')
  const todayKey = toDateKey(startOfDay(today))

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(rangeStart, index)
    return {
      date,
      dateKey: toDateKey(date),
      inCurrentMonth: true,
      isToday: toDateKey(date) === todayKey,
    }
  })
}

export function shiftCalendarAnchor(
  anchorDate: Date,
  viewMode: CalendarViewMode,
  direction: -1 | 1,
): Date {
  if (viewMode === 'week') {
    return addDays(startOfWeekSunday(anchorDate), direction * 7)
  }
  return addMonths(anchorDate, direction)
}

export function formatCalendarPeriodLabel(
  anchorDate: Date,
  viewMode: CalendarViewMode,
): string {
  if (viewMode === 'week') {
    const { rangeStart } = getVisibleCalendarRange(anchorDate, 'week')
    const rangeEnd = addDays(rangeStart, 6)
    const formatter = new Intl.DateTimeFormat('he-IL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    return `${formatter.format(rangeStart)} – ${formatter.format(rangeEnd)}`
  }

  return new Intl.DateTimeFormat('he-IL', {
    month: 'long',
    year: 'numeric',
  }).format(anchorDate)
}

export function formatEventTimeRange(
  startsAt: string,
  endsAt: string,
  timeZone = 'Asia/Jerusalem',
): string {
  const formatter = new Intl.DateTimeFormat('he-IL', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${formatter.format(new Date(startsAt))}–${formatter.format(new Date(endsAt))}`
}

export function formatEventDate(
  startsAt: string,
  timeZone = 'Asia/Jerusalem',
): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(startsAt))
}

export function buildConfirmedCalendarEvents(input: {
  meetings: Meeting[]
  slotsById: Map<string, MeetingSlot>
  directory: Map<string, MeetingUserDirectoryEntry>
  actorUserId: string
}): ConfirmedCalendarEvent[] {
  const events: ConfirmedCalendarEvent[] = []

  for (const meeting of input.meetings) {
    if (meeting.currentState !== 'CONFIRMED') {
      continue
    }
    if (!meeting.confirmedSlotId) {
      continue
    }

    const slot = input.slotsById.get(meeting.confirmedSlotId)
    if (!slot || slot.slotStatus !== 'confirmed') {
      continue
    }

    const participantId =
      meeting.requesterId === input.actorUserId ? meeting.recipientId : meeting.requesterId
    const participant = input.directory.get(participantId)

    events.push({
      meetingId: meeting.id,
      subject: meeting.subject,
      reason: meeting.reason,
      durationMinutes: meeting.durationMinutes,
      status: meeting.currentState,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      timeZone: meeting.institutionTimezone,
      participantId,
      participantName: participant?.fullName ?? 'משתתף',
      participantRole: participant?.primaryRole ?? null,
    })
  }

  return events.sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
  )
}

export function filterEventsForVisibleRange(
  events: ConfirmedCalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): ConfirmedCalendarEvent[] {
  const startMs = rangeStart.getTime()
  const endMs = rangeEnd.getTime()

  return events.filter((event) => {
    const eventStart = new Date(event.startsAt).getTime()
    return eventStart >= startMs && eventStart < endMs
  })
}

export function groupEventsByDateKey(
  events: ConfirmedCalendarEvent[],
): Map<string, ConfirmedCalendarEvent[]> {
  const grouped = new Map<string, ConfirmedCalendarEvent[]>()

  for (const event of events) {
    const key = dateKeyFromIso(event.startsAt, event.timeZone)
    const current = grouped.get(key) ?? []
    current.push(event)
    grouped.set(key, current)
  }

  return grouped
}

export function buildPhase3PendingPanels(input: {
  pendingMeetings: Meeting[]
  upcomingMeetings: Meeting[]
  actorUserId: string
}): Record<MeetingPhase3PanelId, Meeting[]> {
  const panels: Record<MeetingPhase3PanelId, Meeting[]> = {
    waiting_for_my_approval: [],
    waiting_for_me_to_propose: [],
    waiting_for_me_to_choose: [],
    waiting_for_my_final_confirmation: [],
    upcoming: [...input.upcomingMeetings],
  }

  for (const meeting of input.pendingMeetings) {
    const bucket = classifyMeetingPendingBucket(meeting, input.actorUserId)
    if (
      bucket === 'waiting_for_my_approval' ||
      bucket === 'waiting_for_me_to_propose' ||
      bucket === 'waiting_for_me_to_choose' ||
      bucket === 'waiting_for_my_final_confirmation'
    ) {
      panels[bucket].push(meeting)
    }
  }

  return panels
}

export function getParticipantRoleTone(
  role: MeetingCalendarRole | null,
): 'manager' | 'secretary' | 'teacher' | 'default' {
  if (role === 'institution_manager') {
    return 'manager'
  }
  if (role === 'secretary') {
    return 'secretary'
  }
  if (role === 'teacher') {
    return 'teacher'
  }
  return 'default'
}

export function isActionablePendingBucket(
  bucket: MeetingPendingBucket | null,
): bucket is Exclude<MeetingPendingBucket, 'confirmed' | 'waiting_for_other'> {
  return (
    bucket === 'waiting_for_my_approval' ||
    bucket === 'waiting_for_me_to_propose' ||
    bucket === 'waiting_for_me_to_choose' ||
    bucket === 'waiting_for_my_final_confirmation'
  )
}
