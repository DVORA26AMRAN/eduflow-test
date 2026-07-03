import {
  ALLOWED_REQUEST_ATTACHMENT_MIME_TYPES,
  ATTACHMENT_LOAD_ERROR_MESSAGE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  MAX_REQUEST_ATTACHMENT_SIZE_BYTES,
  REQUEST_ATTACHMENTS_BUCKET,
  UNSUPPORTED_ATTACHMENT_TYPE_MESSAGE,
  type RequestAttachment,
  type RequestAttachmentMimeType,
} from '../types/attachment'
import { supabase } from './supabase'

const SIGNED_URL_EXPIRY_SECONDS = 300

export type ValidateRequestAttachmentResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type UploadRequestAttachmentResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type LoadRequestAttachmentsResult =
  | { ok: true; attachments: RequestAttachment[] }
  | { ok: false; errorMessage: string }

export type LoadRequestAttachmentRequestIdsResult =
  | { ok: true; requestIds: ReadonlySet<string> }
  | { ok: false; errorMessage: string }

export type CreateAttachmentSignedUrlResult =
  | { ok: true; signedUrl: string }
  | { ok: false; errorMessage: string }

export function isAllowedRequestAttachmentMimeType(
  mimeType: string,
): mimeType is RequestAttachmentMimeType {
  return (ALLOWED_REQUEST_ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType)
}

export function validateRequestAttachment(file: File): ValidateRequestAttachmentResult {
  if (!isAllowedRequestAttachmentMimeType(file.type)) {
    return {
      ok: false,
      errorMessage: UNSUPPORTED_ATTACHMENT_TYPE_MESSAGE,
    }
  }

  if (file.size <= 0 || file.size > MAX_REQUEST_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      errorMessage: ATTACHMENT_TOO_LARGE_MESSAGE,
    }
  }

  return { ok: true }
}

async function loadCurrentUserInstitutionId(
  userId: string,
): Promise<{ ok: true; institutionId: string } | { ok: false }> {
  const { data, error } = await supabase
    .from('users')
    .select('institution_id')
    .eq('id', userId)
    .single()

  if (error || typeof data?.institution_id !== 'string') {
    console.error('[attachments] failed to load institution_id', error)
    return { ok: false }
  }

  return { ok: true, institutionId: data.institution_id }
}

export async function uploadRequestAttachment(input: {
  requestId: string
  file: File
}): Promise<UploadRequestAttachmentResult> {
  const validation = validateRequestAttachment(input.file)
  if (!validation.ok) {
    return validation
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[attachments] no authenticated session for upload', sessionError)
    return { ok: false, errorMessage: 'upload failed' }
  }

  const userId = sessionData.session.user.id
  const institutionResult = await loadCurrentUserInstitutionId(userId)

  if (!institutionResult.ok) {
    return { ok: false, errorMessage: 'upload failed' }
  }

  const attachmentId = crypto.randomUUID()
  const storagePath = `${institutionResult.institutionId}/${input.requestId}/${attachmentId}/${input.file.name}`

  const { error: uploadError } = await supabase.storage
    .from(REQUEST_ATTACHMENTS_BUCKET)
    .upload(storagePath, input.file, {
      contentType: input.file.type,
      upsert: false,
    })

  if (uploadError) {
    console.error('[attachments] storage upload failed', uploadError)
    return { ok: false, errorMessage: 'upload failed' }
  }

  const { error: insertError } = await supabase.from('request_attachments').insert({
    request_id: input.requestId,
    institution_id: institutionResult.institutionId,
    uploaded_by_user_id: userId,
    storage_bucket: REQUEST_ATTACHMENTS_BUCKET,
    storage_path: storagePath,
    file_name: input.file.name,
    file_type: input.file.type,
    file_size_bytes: input.file.size,
  })

  if (insertError) {
    console.error('[attachments] metadata insert failed', insertError)
    return { ok: false, errorMessage: 'upload failed' }
  }

  return { ok: true }
}

function parseRequestAttachment(row: {
  id: unknown
  request_id: unknown
  storage_path: unknown
  file_name: unknown
  file_type: unknown
  file_size_bytes: unknown
  created_at: unknown
}): RequestAttachment | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.request_id !== 'string' ||
    typeof row.storage_path !== 'string' ||
    typeof row.file_name !== 'string' ||
    typeof row.file_type !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.file_size_bytes !== 'number'
  ) {
    return null
  }

  return {
    id: row.id,
    request_id: row.request_id,
    storage_path: row.storage_path,
    file_name: row.file_name,
    file_type: row.file_type,
    file_size_bytes: row.file_size_bytes,
    created_at: row.created_at,
  }
}

export async function loadRequestAttachments(
  requestId: string,
): Promise<LoadRequestAttachmentsResult> {
  const { data, error } = await supabase
    .from('request_attachments')
    .select('id, request_id, storage_path, file_name, file_type, file_size_bytes, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[attachments] failed to load request attachments', error)
    return {
      ok: false,
      errorMessage: ATTACHMENT_LOAD_ERROR_MESSAGE,
    }
  }

  const attachments = (data ?? [])
    .map(parseRequestAttachment)
    .filter((attachment): attachment is RequestAttachment => attachment !== null)

  return { ok: true, attachments }
}

export async function loadRequestAttachmentRequestIds(): Promise<LoadRequestAttachmentRequestIdsResult> {
  const { data, error } = await supabase
    .from('request_attachments')
    .select('request_id')

  if (error) {
    console.error('[attachments] failed to load attachment request ids', error)
    return {
      ok: false,
      errorMessage: ATTACHMENT_LOAD_ERROR_MESSAGE,
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

export async function createAttachmentSignedUrl(
  storagePath: string,
): Promise<CreateAttachmentSignedUrlResult> {
  const { data, error } = await supabase.storage
    .from(REQUEST_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS)

  if (error || typeof data?.signedUrl !== 'string') {
    console.error('[attachments] failed to create signed url', error)
    return {
      ok: false,
      errorMessage: ATTACHMENT_LOAD_ERROR_MESSAGE,
    }
  }

  return { ok: true, signedUrl: data.signedUrl }
}
