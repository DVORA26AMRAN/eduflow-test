import type { RealtimeChannel } from '@supabase/supabase-js'
import type { TeacherNotification } from '../types/notification'
import { supabase } from './supabase'

export type LoadNotificationsResult =
  | { ok: true; notifications: TeacherNotification[] }
  | { ok: false; errorMessage: string }

export type MarkNotificationAsReadResult =
  | { ok: true }
  | { ok: false }

function parseNotification(row: {
  id: unknown
  notification_type: unknown
  title: unknown
  message: unknown
  is_read: unknown
  metadata: unknown
  created_at: unknown
}): TeacherNotification | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.notification_type !== 'string' ||
    typeof row.title !== 'string' ||
    typeof row.message !== 'string' ||
    typeof row.is_read !== 'boolean' ||
    typeof row.created_at !== 'string' ||
    row.metadata === null ||
    typeof row.metadata !== 'object' ||
    Array.isArray(row.metadata)
  ) {
    return null
  }

  return {
    id: row.id,
    notification_type: row.notification_type,
    title: row.title,
    message: row.message,
    is_read: row.is_read,
    metadata: row.metadata as Record<string, unknown>,
    created_at: row.created_at,
  }
}

export async function loadNotifications(): Promise<LoadNotificationsResult> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[notifications] failed to load notifications', error)
    return {
      ok: false,
      errorMessage: 'טעינת ההתראות נכשלה.',
    }
  }

  const notifications = (data ?? [])
    .map(parseNotification)
    .filter((notification): notification is TeacherNotification => notification !== null)

  return { ok: true, notifications }
}

export async function markNotificationAsRead(
  notificationId: string,
): Promise<MarkNotificationAsReadResult> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)

  if (error) {
    console.error('[notifications] failed to mark notification as read', error)
    return { ok: false }
  }

  return { ok: true }
}

export type TeacherNotificationInsertHandler = (notification: TeacherNotification) => void

export function subscribeToTeacherNotifications(
  userId: string,
  onInsert: TeacherNotificationInsertHandler,
): RealtimeChannel {
  const channel = supabase
    .channel(`teacher-notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const notification = parseNotification(payload.new)
        if (notification) {
          onInsert(notification)
        }
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('[notifications] realtime subscription failed', { userId })
      }
    })

  return channel
}

export async function unsubscribeFromTeacherNotifications(
  channel: RealtimeChannel,
): Promise<void> {
  await supabase.removeChannel(channel)
}
