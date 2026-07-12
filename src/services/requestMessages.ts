import type { RealtimeChannel } from '@supabase/supabase-js'
import type { RequestMessage } from '../types/requestMessage'
import { MESSAGE_LOAD_ERROR, MESSAGE_SEND_ERROR } from '../types/requestMessage'
import { supabase } from './supabase'

export type LoadRequestMessagesResult =
  | { ok: true; messages: RequestMessage[] }
  | { ok: false; errorMessage: string }

export type CreateRequestMessageResult =
  | { ok: true; message: RequestMessage }
  | { ok: false; errorMessage: string }

export type LoadRequestMessageRequestIdsResult =
  | { ok: true; requestIds: Set<string> }
  | { ok: false; errorMessage: string }

function extractJoinedUser(users: unknown): {
  full_name: string | null
  primary_role: string | null
} {
  const row = Array.isArray(users) ? users[0] : users

  if (!row || typeof row !== 'object') {
    return { full_name: null, primary_role: null }
  }

  const candidate = row as { full_name?: unknown; primary_role?: unknown }

  return {
    full_name: typeof candidate.full_name === 'string' ? candidate.full_name : null,
    primary_role:
      typeof candidate.primary_role === 'string' ? candidate.primary_role : null,
  }
}

function parseRequestMessage(row: {
  id: unknown
  request_id: unknown
  author_user_id: unknown
  message: unknown
  created_at: unknown
  users: unknown
}): RequestMessage | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.request_id !== 'string' ||
    typeof row.author_user_id !== 'string' ||
    typeof row.message !== 'string' ||
    typeof row.created_at !== 'string'
  ) {
    return null
  }

  const author = extractJoinedUser(row.users)

  return {
    id: row.id,
    request_id: row.request_id,
    author_user_id: row.author_user_id,
    message: row.message,
    created_at: row.created_at,
    author_full_name: author.full_name,
    author_primary_role: author.primary_role,
  }
}

export function appendRequestMessageIfNew(
  currentMessages: RequestMessage[],
  incomingMessage: RequestMessage,
): RequestMessage[] {
  if (currentMessages.some((message) => message.id === incomingMessage.id)) {
    return currentMessages
  }

  return [...currentMessages, incomingMessage].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  )
}

export async function loadRequestMessages(
  requestId: string,
): Promise<LoadRequestMessagesResult> {
  const { data, error } = await supabase
    .from('request_messages')
    .select(
      'id, request_id, author_user_id, message, created_at, users!author_user_id(full_name, primary_role)',
    )
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[requestMessages] failed to load messages', error)
    return {
      ok: false,
      errorMessage: MESSAGE_LOAD_ERROR,
    }
  }

  const messages = (data ?? [])
    .map(parseRequestMessage)
    .filter((message): message is RequestMessage => message !== null)

  return { ok: true, messages }
}

export async function createRequestMessage(input: {
  requestId: string
  message: string
}): Promise<CreateRequestMessageResult> {
  const trimmedMessage = input.message.trim()

  if (!trimmedMessage) {
    return {
      ok: false,
      errorMessage: MESSAGE_SEND_ERROR,
    }
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[requestMessages] no authenticated session for create', sessionError)
    return { ok: false, errorMessage: MESSAGE_SEND_ERROR }
  }

  const userId = sessionData.session.user.id

  const { data, error } = await supabase
    .from('request_messages')
    .insert({
      request_id: input.requestId,
      author_user_id: userId,
      message: trimmedMessage,
    })
    .select(
      'id, request_id, author_user_id, message, created_at, users!author_user_id(full_name, primary_role)',
    )
    .single()

  if (error) {
    console.error('[requestMessages] failed to create message', error)
    return { ok: false, errorMessage: MESSAGE_SEND_ERROR }
  }

  const message = parseRequestMessage(data)

  if (!message) {
    return { ok: false, errorMessage: MESSAGE_SEND_ERROR }
  }

  return { ok: true, message }
}

export type RequestMessageInsertHandler = (message: RequestMessage) => void

export function subscribeToRequestMessages(
  requestId: string,
  onInsert: RequestMessageInsertHandler,
): RealtimeChannel {
  const channel = supabase
    .channel(`request-messages:${requestId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'request_messages',
        filter: `request_id=eq.${requestId}`,
      },
      (payload) => {
        void (async () => {
          const result = await loadRequestMessages(requestId)
          if (!result.ok) {
            return
          }

          const insertedId =
            payload.new && typeof payload.new === 'object' && 'id' in payload.new
              ? payload.new.id
              : null

          const insertedMessage = result.messages.find((message) => message.id === insertedId)

          if (insertedMessage) {
            onInsert(insertedMessage)
          }
        })()
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('[requestMessages] realtime subscription failed', { requestId })
      }
    })

  return channel
}

export async function unsubscribeFromRequestMessages(channel: RealtimeChannel): Promise<void> {
  await supabase.removeChannel(channel)
}

export async function loadRequestMessageRequestIds(): Promise<LoadRequestMessageRequestIdsResult> {
  const { data, error } = await supabase.from('request_messages').select('request_id')

  if (error) {
    console.error('[requestMessages] failed to load message request ids', error)
    return {
      ok: false,
      errorMessage: MESSAGE_LOAD_ERROR,
    }
  }

  const requestIds = new Set<string>()

  for (const row of data ?? []) {
    if (typeof row.request_id === 'string') {
      requestIds.add(row.request_id)
    }
  }

  return { ok: true, requestIds }
}
