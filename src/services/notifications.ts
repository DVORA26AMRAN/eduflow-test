import type { RealtimeChannel } from '@supabase/supabase-js'
import type { TeacherNotification } from '../types/notification'
import { NOTIFICATION_TYPE_REQUEST_REMINDER } from '../types/requestReminder'
import type { AdminNotification } from '../types/requestReminder'
import { supabase } from './supabase'

export type AppNotification = TeacherNotification | AdminNotification

export type LoadNotificationsResult =
  | { ok: true; notifications: AppNotification[] }
  | { ok: false; errorMessage: string }

export type MarkNotificationAsReadResult =
  | { ok: true }
  | { ok: false }

function parseNotification(row: unknown): AppNotification | null {
  if (!row || typeof row !== 'object') {
    return null
  }

  const candidate = row as {
    id?: unknown
    notification_type?: unknown
    title?: unknown
    message?: unknown
    is_read?: unknown
    metadata?: unknown
    created_at?: unknown
  }

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.notification_type !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.message !== 'string' ||
    typeof candidate.is_read !== 'boolean' ||
    typeof candidate.created_at !== 'string' ||
    candidate.metadata === null ||
    typeof candidate.metadata !== 'object' ||
    Array.isArray(candidate.metadata)
  ) {
    return null
  }

  return {
    id: candidate.id,
    notification_type: candidate.notification_type,
    title: candidate.title,
    message: candidate.message,
    is_read: candidate.is_read,
    metadata: candidate.metadata as Record<string, unknown>,
    created_at: candidate.created_at,
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
    .filter((notification): notification is AppNotification => notification !== null)

  return { ok: true, notifications }
}

export async function loadAdminNotifications(): Promise<LoadNotificationsResult> {
  return loadNotifications()
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

export type NotificationInsertHandler = (notification: AppNotification) => void

export function subscribeToUserNotifications(
  userId: string,
  onInsert: NotificationInsertHandler,
): RealtimeChannel {
  const channel = supabase
    .channel(`user-notifications:${userId}`)
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

export type TeacherNotificationInsertHandler = NotificationInsertHandler

export function subscribeToTeacherNotifications(
  userId: string,
  onInsert: TeacherNotificationInsertHandler,
): RealtimeChannel {
  return subscribeToUserNotifications(userId, onInsert)
}

export function subscribeToAdminNotifications(
  userId: string,
  onInsert: NotificationInsertHandler,
): RealtimeChannel {
  return subscribeToUserNotifications(userId, onInsert)
}

export async function unsubscribeFromUserNotifications(
  channel: RealtimeChannel,
): Promise<void> {
  await supabase.removeChannel(channel)
}

export async function unsubscribeFromTeacherNotifications(
  channel: RealtimeChannel,
): Promise<void> {
  await unsubscribeFromUserNotifications(channel)
}

export async function unsubscribeFromAdminNotifications(
  channel: RealtimeChannel,
): Promise<void> {
  await unsubscribeFromUserNotifications(channel)
}

export function getUnreadReminderRequestIds(notifications: AppNotification[]): Set<string> {
  const requestIds = new Set<string>()

  for (const notification of notifications) {
    if (
      notification.notification_type !== NOTIFICATION_TYPE_REQUEST_REMINDER ||
      notification.is_read
    ) {
      continue
    }

    const requestId = notification.metadata.request_id
    if (typeof requestId === 'string') {
      requestIds.add(requestId)
    }
  }

  return requestIds
}
