import type { RealtimeChannel } from '@supabase/supabase-js'
import type { RequestStatus } from '../types/request'
import type {
  RequestReminderSummary,
  TeacherRequestReminderState,
} from '../types/requestReminder'
import { REQUEST_REMINDER_COOLDOWN_HOURS } from '../types/requestReminder'
import { supabase } from './supabase'

export type SendRequestReminderResult =
  | { ok: true; reminderCount: number; createdAt: string }
  | { ok: false; errorMessage: string; nextReminderAvailableAt?: string }

export type LoadTeacherRequestReminderStatesResult =
  | { ok: true; states: TeacherRequestReminderState[] }
  | { ok: false; errorMessage: string }

export type LoadInstitutionRequestReminderSummariesResult =
  | { ok: true; summaries: RequestReminderSummary[] }
  | { ok: false; errorMessage: string }

function parseReminderRow(row: {
  request_id: unknown
  reminder_number: unknown
  created_at: unknown
}): { request_id: string; reminder_number: number; created_at: string } | null {
  if (
    typeof row.request_id !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.reminder_number !== 'number'
  ) {
    return null
  }

  return {
    request_id: row.request_id,
    reminder_number: row.reminder_number,
    created_at: row.created_at,
  }
}

function addHours(isoTimestamp: string, hours: number): string {
  const date = new Date(isoTimestamp)
  date.setHours(date.getHours() + hours)
  return date.toISOString()
}

function isCooldownActive(lastReminderAt: string): boolean {
  const nextAvailableAt = new Date(addHours(lastReminderAt, REQUEST_REMINDER_COOLDOWN_HOURS))
  return nextAvailableAt.getTime() > Date.now()
}

export function canSendRequestReminder(status: string): status is RequestStatus {
  return status === 'new' || status === 'in_progress'
}

export async function sendRequestReminder(requestId: string): Promise<SendRequestReminderResult> {
  const { data, error } = await supabase.rpc('send_request_reminder', {
    p_request_id: requestId,
  })

  if (error) {
    console.error('[requestReminders] failed to send reminder', error)

    if (error.message.includes('new or in-progress') || error.message.includes('pending')) {
      return {
        ok: false,
        errorMessage: 'ניתן לשלוח תזכורת רק לבקשות חדשות או בטיפול.',
      }
    }

    return {
      ok: false,
      errorMessage: 'שליחת התזכורת נכשלה.',
    }
  }

  if (!data || typeof data !== 'object') {
    return {
      ok: false,
      errorMessage: 'שליחת התזכורת נכשלה.',
    }
  }

  const result = data as {
    ok?: unknown
    error_code?: unknown
    next_available_at?: unknown
    reminder_count?: unknown
    created_at?: unknown
  }

  if (result.ok === false) {
    if (
      result.error_code === 'cooldown_active' &&
      typeof result.next_available_at === 'string'
    ) {
      return {
        ok: false,
        errorMessage: 'ניתן לשלוח תזכורת נוספת רק לאחר תקופת ההמתנה.',
        nextReminderAvailableAt: result.next_available_at,
      }
    }

    return {
      ok: false,
      errorMessage: 'שליחת התזכורת נכשלה.',
    }
  }

  if (typeof result.reminder_count !== 'number' || typeof result.created_at !== 'string') {
    return {
      ok: false,
      errorMessage: 'שליחת התזכורת נכשלה.',
    }
  }

  return {
    ok: true,
    reminderCount: result.reminder_count,
    createdAt: result.created_at,
  }
}

export async function loadTeacherRequestReminderStates(): Promise<LoadTeacherRequestReminderStatesResult> {
  const { data, error } = await supabase
    .from('request_reminders')
    .select('request_id, reminder_number, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[requestReminders] failed to load teacher reminder states', error)
    return {
      ok: false,
      errorMessage: 'טעינת מצב התזכורות נכשלה.',
    }
  }

  const latestByRequest = new Map<string, { reminder_count: number; last_reminder_at: string }>()

  for (const row of data ?? []) {
    const parsed = parseReminderRow(row)
    if (!parsed || latestByRequest.has(parsed.request_id)) {
      continue
    }

    latestByRequest.set(parsed.request_id, {
      reminder_count: parsed.reminder_number,
      last_reminder_at: parsed.created_at,
    })
  }

  const states: TeacherRequestReminderState[] = Array.from(latestByRequest.entries()).map(
    ([requestId, summary]) => {
      const cooldownActive = isCooldownActive(summary.last_reminder_at)

      return {
        request_id: requestId,
        reminder_count: summary.reminder_count,
        last_reminder_at: summary.last_reminder_at,
        next_reminder_available_at: cooldownActive
          ? addHours(summary.last_reminder_at, REQUEST_REMINDER_COOLDOWN_HOURS)
          : null,
      }
    },
  )

  return { ok: true, states }
}

export async function loadInstitutionRequestReminderSummaries(): Promise<LoadInstitutionRequestReminderSummariesResult> {
  const { data, error } = await supabase
    .from('request_reminders')
    .select('request_id, reminder_number, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[requestReminders] failed to load institution reminder summaries', error)
    return {
      ok: false,
      errorMessage: 'טעינת נתוני התזכורות נכשלה.',
    }
  }

  const summariesByRequest = new Map<string, RequestReminderSummary>()

  for (const row of data ?? []) {
    const parsed = parseReminderRow(row)
    if (!parsed) {
      continue
    }

    const existing = summariesByRequest.get(parsed.request_id)
    if (!existing) {
      summariesByRequest.set(parsed.request_id, {
        request_id: parsed.request_id,
        reminder_count: parsed.reminder_number,
        latest_reminder_at: parsed.created_at,
      })
      continue
    }

    summariesByRequest.set(parsed.request_id, {
      request_id: parsed.request_id,
      reminder_count: Math.max(existing.reminder_count, parsed.reminder_number),
      latest_reminder_at:
        existing.latest_reminder_at > parsed.created_at
          ? existing.latest_reminder_at
          : parsed.created_at,
    })
  }

  return {
    ok: true,
    summaries: Array.from(summariesByRequest.values()),
  }
}

export type RequestReminderInsertHandler = (summary: RequestReminderSummary) => void

export function subscribeToInstitutionRequestReminders(
  institutionId: string,
  onInsert: RequestReminderInsertHandler,
): RealtimeChannel {
  const channel = supabase
    .channel(`institution-request-reminders:${institutionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'request_reminders',
        filter: `institution_id=eq.${institutionId}`,
      },
      (payload) => {
        const row = payload.new as {
          request_id?: unknown
          reminder_number?: unknown
          created_at?: unknown
        }

        if (
          typeof row.request_id !== 'string' ||
          typeof row.reminder_number !== 'number' ||
          typeof row.created_at !== 'string'
        ) {
          return
        }

        onInsert({
          request_id: row.request_id,
          reminder_count: row.reminder_number,
          latest_reminder_at: row.created_at,
        })
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('[requestReminders] realtime subscription failed', { institutionId })
      }
    })

  return channel
}

export async function unsubscribeFromInstitutionRequestReminders(
  channel: RealtimeChannel,
): Promise<void> {
  await supabase.removeChannel(channel)
}

function mergeReminderSummary(
  currentSummary: RequestReminderSummary | undefined,
  incomingSummary: RequestReminderSummary,
): RequestReminderSummary {
  if (!currentSummary) {
    return incomingSummary
  }

  return {
    request_id: incomingSummary.request_id,
    reminder_count: Math.max(currentSummary.reminder_count, incomingSummary.reminder_count),
    latest_reminder_at:
      incomingSummary.latest_reminder_at > currentSummary.latest_reminder_at
        ? incomingSummary.latest_reminder_at
        : currentSummary.latest_reminder_at,
  }
}

export function upsertReminderSummary(
  summaries: ReadonlyMap<string, RequestReminderSummary>,
  incomingSummary: RequestReminderSummary,
): Map<string, RequestReminderSummary> {
  const nextSummaries = new Map(summaries)
  nextSummaries.set(
    incomingSummary.request_id,
    mergeReminderSummary(summaries.get(incomingSummary.request_id), incomingSummary),
  )
  return nextSummaries
}
