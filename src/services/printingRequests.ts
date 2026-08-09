import { supabase } from './supabase'
import type { PrintItemInput, PrintingRpcResult } from '../types/printing'
import { PRINTING_RPC } from '../types/printing'
import {
  parseClaimRequestResult,
  parseCreateRequestResult,
  parseInstitutionSettingsResult,
  parseItemStatusResult,
  parsePrintingRpcResult,
  parseStatusResult,
  parseTransferRequestResult,
  parseUpdateRequestResult,
  type PrintingClaimRequestResult,
  type PrintingCreateRequestResult,
  type PrintingInstitutionSettingsResult,
  type PrintingItemStatusResult,
  type PrintingStatusResult,
  type PrintingTransferRequestResult,
  type PrintingUpdateRequestResult,
} from './printingRpcResult'

export type {
  PrintingClaimRequestResult,
  PrintingCreateRequestResult,
  PrintingInstitutionSettingsResult,
  PrintingItemStatusResult,
  PrintingStatusResult,
  PrintingTransferRequestResult,
  PrintingUpdateRequestResult,
}

/** Controlled create - teacher/institution taken from auth context server-side. */
export async function createPrintingRequest(params: {
  requiredBy: string
  items: PrintItemInput[]
}): Promise<PrintingRpcResult<PrintingCreateRequestResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.createRequest, {
    p_required_by: params.requiredBy,
    p_items: params.items,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseCreateRequestResult)
}

export async function updatePrintingRequest(params: {
  printingRequestId: string
  requiredBy?: string | null
  items?: PrintItemInput[] | null
}): Promise<PrintingRpcResult<PrintingUpdateRequestResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.updateRequest, {
    p_printing_request_id: params.printingRequestId,
    p_required_by: params.requiredBy ?? null,
    p_items: params.items ?? null,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseUpdateRequestResult)
}

export async function cancelPrintingRequest(
  printingRequestId: string,
  reason?: string,
): Promise<PrintingRpcResult<PrintingStatusResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.cancelRequest, {
    p_printing_request_id: printingRequestId,
    p_reason: reason ?? null,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseStatusResult)
}

export async function claimPrintingRequest(
  printingRequestId: string,
): Promise<PrintingRpcResult<PrintingClaimRequestResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.claimRequest, {
    p_printing_request_id: printingRequestId,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseClaimRequestResult)
}

export async function releasePrintingRequest(
  printingRequestId: string,
): Promise<PrintingRpcResult<PrintingStatusResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.releaseRequest, {
    p_printing_request_id: printingRequestId,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseStatusResult)
}

export async function transferPrintingRequest(params: {
  printingRequestId: string
  targetSecretaryUserId: string
}): Promise<PrintingRpcResult<PrintingTransferRequestResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.transferRequest, {
    p_printing_request_id: params.printingRequestId,
    p_target_secretary_user_id: params.targetSecretaryUserId,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseTransferRequestResult)
}

export async function returnPrintItemForCorrection(params: {
  printItemId: string
  reason: string
}): Promise<PrintingRpcResult<PrintingItemStatusResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.returnItemForCorrection, {
    p_print_item_id: params.printItemId,
    p_reason: params.reason,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseItemStatusResult)
}

export async function resubmitPrintItem(params: {
  printItemId: string
  item?: PrintItemInput | null
}): Promise<PrintingRpcResult<PrintingItemStatusResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.resubmitItem, {
    p_print_item_id: params.printItemId,
    p_item: params.item ?? null,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseItemStatusResult)
}

export async function rejectPrintItem(params: {
  printItemId: string
  reason: string
}): Promise<PrintingRpcResult<PrintingItemStatusResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.rejectItem, {
    p_print_item_id: params.printItemId,
    p_reason: params.reason,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseItemStatusResult)
}

export async function markPrintItemPrinted(
  printItemId: string,
): Promise<PrintingRpcResult<PrintingItemStatusResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.markItemPrinted, {
    p_print_item_id: printItemId,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseItemStatusResult)
}

export async function updateInstitutionPrintingSettings(params: {
  minimumPrintNoticeMinutes?: number | null
  deadlineWarningMinutes?: number | null
  fileRetentionDays?: number | null
}): Promise<PrintingRpcResult<PrintingInstitutionSettingsResult>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.updateInstitutionSettings, {
    p_minimum_print_notice_minutes: params.minimumPrintNoticeMinutes ?? null,
    p_deadline_warning_minutes: params.deadlineWarningMinutes ?? null,
    p_file_retention_days: params.fileRetentionDays ?? null,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  return parsePrintingRpcResult(data, parseInstitutionSettingsResult)
}
/** Authorized read via RLS — request number must never be used for authorization. */
export async function getAuthorizedPrintingRequest(printingRequestId: string) {
  return supabase
    .from('printing_requests')
    .select('*, print_items(*)')
    .eq('id', printingRequestId)
    .maybeSingle()
}

/** Teacher-owned list only — RLS enforces isolation; do not fetch institution-wide. */
export async function listMyPrintingRequests(): Promise<
  | { ok: true; requests: PrintingRequestListRow[] }
  | { ok: false; errorMessage: string }
> {
  const { data, error } = await supabase
    .from('printing_requests')
    .select(
      `
      id,
      request_number,
      required_by,
      status,
      submitted_at,
      updated_at,
      cancelled_at,
      processing_started_at,
      assigned_secretary_user_id,
      teacher_user_id,
      institution_id,
      files_purged_at,
      print_items ( id, status, original_filename, display_order )
    `,
    )
    .order('submitted_at', { ascending: false })

  if (error) {
    return { ok: false, errorMessage: 'טעינת בקשות ההדפסה נכשלה.' }
  }

  return { ok: true, requests: (data ?? []) as PrintingRequestListRow[] }
}

export type PrintingRequestListRow = {
  id: string
  request_number: number
  required_by: string
  status: string
  submitted_at: string
  updated_at: string
  cancelled_at: string | null
  processing_started_at: string | null
  assigned_secretary_user_id: string | null
  teacher_user_id: string
  institution_id: string
  files_purged_at: string | null
  print_items: Array<{
    id: string
    status: string
    original_filename: string
    display_order: number
  }> | null
}

export async function loadInstitutionPrintingSettings(institutionId: string): Promise<
  | {
      ok: true
      minimumPrintNoticeMinutes: number
      deadlineWarningMinutes: number
      fileRetentionDays: number
      timeZone: string
    }
  | { ok: false; errorMessage: string }
> {
  const { data, error } = await supabase
    .from('institutions')
    .select(
      'minimum_print_notice_minutes, deadline_warning_minutes, file_retention_days, timezone',
    )
    .eq('id', institutionId)
    .maybeSingle()

  if (error || !data) {
    return { ok: false, errorMessage: 'טעינת הגדרות ההדפסה נכשלה.' }
  }

  return {
    ok: true,
    minimumPrintNoticeMinutes: Number(data.minimum_print_notice_minutes ?? 60),
    deadlineWarningMinutes: Number(data.deadline_warning_minutes ?? 120),
    fileRetentionDays: Number(data.file_retention_days ?? 90),
    timeZone: String(data.timezone || 'UTC'),
  }
}

/** Upload a local file to the private printing-files path returned by create/update. */
export async function uploadPrintingFile(params: {
  storageObjectPath: string
  file: File
  contentType: string
}): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  const { error } = await supabase.storage
    .from('printing-files')
    .upload(params.storageObjectPath, params.file, {
      upsert: true,
      contentType: params.contentType,
    })

  if (error) {
    return { ok: false, errorMessage: 'העלאת הקובץ נכשלה. ניתן לנסות שוב.' }
  }
  return { ok: true }
}

/** Authorized private file access via storage RLS (no public URLs). */
export async function createPrintingFileSignedUrl(params: {
  storageObjectPath: string
  expiresInSeconds?: number
}) {
  return supabase.storage
    .from('printing-files')
    .createSignedUrl(params.storageObjectPath, params.expiresInSeconds ?? 60)
}

export type InstitutionPrintingRequestRow = {
  id: string
  request_number: number
  required_by: string
  status: string
  submitted_at: string
  updated_at: string
  cancelled_at: string | null
  processing_started_at: string | null
  assigned_secretary_user_id: string | null
  teacher_user_id: string
  institution_id: string
  files_purged_at: string | null
  teacher_full_name: string
  assigned_secretary_full_name: string | null
  print_items: Array<{
    id: string
    status: string
    original_filename: string
    display_order: number
    detected_file_type: string
    file_size_bytes: number
    storage_object_path: string | null
    page_selection_mode: string
    page_selection_value: string | null
    copies: number
    color_mode: string
    paper_size: string
    orientation: string
    sides: string
    duplex_flip_mode: string | null
    pages_per_sheet: number
    scale_mode: string
    custom_scale_percent: number | null
    collate: boolean
    notes: string | null
    correction_reason: string | null
    rejection_reason: string | null
    file_purged_at?: string | null
  }> | null
}

function extractJoinedFullName(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value[0] as { full_name?: unknown } | undefined
    return typeof first?.full_name === 'string' ? first.full_name : null
  }
  if (value && typeof value === 'object' && 'full_name' in value) {
    const name = (value as { full_name: unknown }).full_name
    return typeof name === 'string' ? name : null
  }
  return null
}

/**
 * Institution-wide printing queue for secretary/manager.
 * Visibility is enforced by Phase 1 RLS — never fetch another institution and filter locally.
 */
export async function listInstitutionPrintingRequests(): Promise<
  | { ok: true; requests: InstitutionPrintingRequestRow[] }
  | { ok: false; errorMessage: string }
> {
  const { data, error } = await supabase
    .from('printing_requests')
    .select(
      `
      id,
      request_number,
      required_by,
      status,
      submitted_at,
      updated_at,
      cancelled_at,
      processing_started_at,
      assigned_secretary_user_id,
      teacher_user_id,
      institution_id,
      files_purged_at,
      users!teacher_user_id ( full_name ),
      assignee:users!assigned_secretary_user_id ( full_name ),
      print_items (
        id,
        status,
        original_filename,
        display_order,
        detected_file_type,
        file_size_bytes,
        storage_object_path,
        page_selection_mode,
        page_selection_value,
        copies,
        color_mode,
        paper_size,
        orientation,
        sides,
        duplex_flip_mode,
        pages_per_sheet,
        scale_mode,
        custom_scale_percent,
        collate,
        notes,
        correction_reason,
        rejection_reason,
        file_purged_at
      )
    `,
    )
    .order('required_by', { ascending: true })

  if (error) {
    return { ok: false, errorMessage: 'טעינת תור ההדפסות נכשלה.' }
  }

  const requests: InstitutionPrintingRequestRow[] = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>
    const items = Array.isArray(r.print_items) ? r.print_items : []
    return {
      id: String(r.id),
      request_number: Number(r.request_number),
      required_by: String(r.required_by),
      status: String(r.status),
      submitted_at: String(r.submitted_at),
      updated_at: String(r.updated_at),
      cancelled_at: (r.cancelled_at as string | null) ?? null,
      processing_started_at: (r.processing_started_at as string | null) ?? null,
      assigned_secretary_user_id: (r.assigned_secretary_user_id as string | null) ?? null,
      teacher_user_id: String(r.teacher_user_id),
      institution_id: String(r.institution_id),
      files_purged_at: (r.files_purged_at as string | null) ?? null,
      teacher_full_name: extractJoinedFullName(r.users) ?? 'מורה',
      assigned_secretary_full_name: extractJoinedFullName(r.assignee),
      print_items: items as InstitutionPrintingRequestRow['print_items'],
    }
  })

  return { ok: true, requests }
}

export type InstitutionSecretaryOption = {
  id: string
  fullName: string
}

/** Same-institution active secretaries for transfer (RLS scopes users). */
export async function listInstitutionSecretariesForTransfer(): Promise<
  | { ok: true; secretaries: InstitutionSecretaryOption[] }
  | { ok: false; errorMessage: string }
> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, primary_role, status')
    .eq('primary_role', 'secretary')
    .eq('status', 'active')
    .order('full_name', { ascending: true })

  if (error) {
    return { ok: false, errorMessage: 'טעינת רשימת המזכירות נכשלה.' }
  }

  const secretaries: InstitutionSecretaryOption[] = []
  for (const row of data ?? []) {
    if (typeof row.id !== 'string' || typeof row.full_name !== 'string') continue
    secretaries.push({ id: row.id, fullName: row.full_name })
  }
  return { ok: true, secretaries }
}

/**
 * Secure temporary access for Open / Download / Print.
 * Never constructs public URLs; signed URL is short-lived and RLS-gated.
 */
export async function accessPrintingFile(params: {
  storageObjectPath: string | null | undefined
  filesPurgedAt: string | null | undefined
  itemFilePurgedAt?: string | null | undefined
  expiresInSeconds?: number
}): Promise<
  | { ok: true; signedUrl: string }
  | { ok: false; errorCode: 'PRINT_FILE_NOT_AVAILABLE' | 'PRINT_REQUEST_FORBIDDEN'; errorMessage: string }
> {
  if (params.filesPurgedAt || params.itemFilePurgedAt || !params.storageObjectPath) {
    return {
      ok: false,
      errorCode: 'PRINT_FILE_NOT_AVAILABLE',
      errorMessage: 'הקובץ אינו נשמר עוד במערכת.',
    }
  }

  const { data, error } = await createPrintingFileSignedUrl({
    storageObjectPath: params.storageObjectPath,
    expiresInSeconds: params.expiresInSeconds ?? 60,
  })

  if (error || !data?.signedUrl) {
    return {
      ok: false,
      errorCode: 'PRINT_REQUEST_FORBIDDEN',
      errorMessage: 'אין הרשאה לפתוח את הקובץ או שהקובץ אינו זמין.',
    }
  }

  return { ok: true, signedUrl: data.signedUrl }
}
