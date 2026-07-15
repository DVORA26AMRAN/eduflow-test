import type { MeetingCalendarRole } from '../types/meetingCalendar'
import { isMeetingCalendarRole } from '../utils/meetingCalendar'
import type { MeetingUserDirectoryEntry } from '../utils/meetingCalendarDisplay'
import { filterEligibleMeetingRecipients } from '../utils/meetingCalendarDisplay'
import { supabase } from './supabase'

export type LoadMeetingUserDirectoryResult =
  | { ok: true; users: MeetingUserDirectoryEntry[] }
  | { ok: false; errorMessage: string }

export async function loadMeetingUserDirectory(): Promise<LoadMeetingUserDirectoryResult> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, primary_role, status')
    .order('full_name', { ascending: true })

  if (error) {
    console.error('[meetingRecipients] failed to load users', error)
    return { ok: false, errorMessage: 'לא ניתן לטעון את רשימת הנמענים.' }
  }

  const users: MeetingUserDirectoryEntry[] = []

  for (const row of data ?? []) {
    if (
      typeof row.id !== 'string' ||
      typeof row.full_name !== 'string' ||
      typeof row.primary_role !== 'string' ||
      typeof row.status !== 'string' ||
      !isMeetingCalendarRole(row.primary_role)
    ) {
      continue
    }

    users.push({
      id: row.id,
      fullName: row.full_name,
      primaryRole: row.primary_role,
      status: row.status,
    })
  }

  return { ok: true, users }
}

export function loadEligibleMeetingRecipients(
  users: MeetingUserDirectoryEntry[],
  actorUserId: string,
  actorRole: MeetingCalendarRole,
): MeetingUserDirectoryEntry[] {
  return filterEligibleMeetingRecipients(users, actorUserId, actorRole)
}
