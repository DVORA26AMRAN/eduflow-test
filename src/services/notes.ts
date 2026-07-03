import type { RequestNote } from '../types/note'
import {
  NOTE_SAVE_ERROR_MESSAGE,
  NOTES_LOAD_ERROR_MESSAGE,
} from '../types/note'
import { supabase } from './supabase'

export type LoadRequestNotesResult =
  | { ok: true; notes: RequestNote[] }
  | { ok: false; errorMessage: string }

export type CreateRequestNoteResult =
  | { ok: true; note: RequestNote }
  | { ok: false; errorMessage: string }

export type UpdateRequestNoteResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type DeleteRequestNoteResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

async function loadCurrentUserInstitutionId(
  userId: string,
): Promise<{ ok: true; institutionId: string } | { ok: false }> {
  const { data, error } = await supabase
    .from('users')
    .select('institution_id')
    .eq('id', userId)
    .single()

  if (error || typeof data?.institution_id !== 'string') {
    console.error('[notes] failed to load institution_id', error)
    return { ok: false }
  }

  return { ok: true, institutionId: data.institution_id }
}

function extractUserFullName(users: unknown): string | null {
  if (Array.isArray(users)) {
    const first = users[0] as { full_name?: unknown } | undefined
    return typeof first?.full_name === 'string' ? first.full_name : null
  }

  if (users && typeof users === 'object' && 'full_name' in users) {
    const fullName = (users as { full_name: unknown }).full_name
    return typeof fullName === 'string' ? fullName : null
  }

  return null
}

function parseRequestNote(row: {
  id: unknown
  request_id: unknown
  note_text: unknown
  created_at: unknown
  updated_at: unknown
  users: unknown
}): RequestNote | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.request_id !== 'string' ||
    typeof row.note_text !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    return null
  }

  return {
    id: row.id,
    request_id: row.request_id,
    note_text: row.note_text,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by_full_name: extractUserFullName(row.users),
  }
}

export async function loadRequestNotes(requestId: string): Promise<LoadRequestNotesResult> {
  const { data, error } = await supabase
    .from('request_notes')
    .select(
      'id, request_id, note_text, created_at, updated_at, users!created_by_user_id(full_name)',
    )
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[notes] failed to load request notes', error)
    return {
      ok: false,
      errorMessage: NOTES_LOAD_ERROR_MESSAGE,
    }
  }

  const notes = (data ?? [])
    .map(parseRequestNote)
    .filter((note): note is RequestNote => note !== null)

  return { ok: true, notes }
}

export async function createRequestNote(input: {
  requestId: string
  noteText: string
}): Promise<CreateRequestNoteResult> {
  const trimmedText = input.noteText.trim()

  if (!trimmedText) {
    return {
      ok: false,
      errorMessage: NOTE_SAVE_ERROR_MESSAGE,
    }
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[notes] no authenticated session for create', sessionError)
    return {
      ok: false,
      errorMessage: NOTE_SAVE_ERROR_MESSAGE,
    }
  }

  const userId = sessionData.session.user.id
  const institutionResult = await loadCurrentUserInstitutionId(userId)

  if (!institutionResult.ok) {
    return {
      ok: false,
      errorMessage: NOTE_SAVE_ERROR_MESSAGE,
    }
  }

  const { data, error } = await supabase
    .from('request_notes')
    .insert({
      request_id: input.requestId,
      institution_id: institutionResult.institutionId,
      created_by_user_id: userId,
      note_text: trimmedText,
    })
    .select(
      'id, request_id, note_text, created_at, updated_at, users!created_by_user_id(full_name)',
    )
    .single()

  if (error) {
    console.error('[notes] failed to create request note', error)
    return {
      ok: false,
      errorMessage: NOTE_SAVE_ERROR_MESSAGE,
    }
  }

  const note = parseRequestNote(data)

  if (!note) {
    return {
      ok: false,
      errorMessage: NOTE_SAVE_ERROR_MESSAGE,
    }
  }

  return { ok: true, note }
}

export async function updateRequestNote(input: {
  noteId: string
  noteText: string
}): Promise<UpdateRequestNoteResult> {
  const trimmedText = input.noteText.trim()

  if (!trimmedText) {
    return {
      ok: false,
      errorMessage: NOTE_SAVE_ERROR_MESSAGE,
    }
  }

  const { error } = await supabase
    .from('request_notes')
    .update({ note_text: trimmedText })
    .eq('id', input.noteId)

  if (error) {
    console.error('[notes] failed to update request note', error)
    return {
      ok: false,
      errorMessage: NOTE_SAVE_ERROR_MESSAGE,
    }
  }

  return { ok: true }
}

export async function deleteRequestNote(noteId: string): Promise<DeleteRequestNoteResult> {
  const { error } = await supabase.from('request_notes').delete().eq('id', noteId)

  if (error) {
    console.error('[notes] failed to delete request note', error)
    return {
      ok: false,
      errorMessage: NOTE_SAVE_ERROR_MESSAGE,
    }
  }

  return { ok: true }
}
