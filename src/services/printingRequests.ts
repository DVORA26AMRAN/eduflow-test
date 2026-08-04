import { supabase } from './supabase'
import type { PrintItemInput, PrintingRpcResult } from '../types/printing'
import { PRINTING_RPC } from '../types/printing'

type Json = Record<string, unknown>

function asRpcResult<T extends Record<string, unknown>>(data: unknown): PrintingRpcResult<T> {
  const row = data as Json | null
  if (!row || typeof row !== 'object') {
    return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  }
  if (row.ok === true) return row as PrintingRpcResult<T> & { ok: true }
  return {
    ok: false,
    error_code: (row.error_code as PrintingRpcResult['error_code']) ?? 'PRINT_REQUEST_FORBIDDEN',
  }
}

/** Controlled create — teacher/institution taken from auth context server-side. */
export async function createPrintingRequest(params: {
  requiredBy: string
  items: PrintItemInput[]
}): Promise<
  PrintingRpcResult<{
    printing_request_id: string
    request_number: number
    items: Array<{ id: string; storage_object_path: string; display_order: number }>
  }>
> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.createRequest, {
    p_required_by: params.requiredBy,
    p_items: params.items,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
}

export async function updatePrintingRequest(params: {
  printingRequestId: string
  requiredBy?: string | null
  items?: PrintItemInput[] | null
}): Promise<PrintingRpcResult<{ printing_request_id: string; status: string }>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.updateRequest, {
    p_printing_request_id: params.printingRequestId,
    p_required_by: params.requiredBy ?? null,
    p_items: params.items ?? null,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
}

export async function cancelPrintingRequest(
  printingRequestId: string,
  reason?: string,
): Promise<PrintingRpcResult<{ status: string }>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.cancelRequest, {
    p_printing_request_id: printingRequestId,
    p_reason: reason ?? null,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
}

export async function claimPrintingRequest(
  printingRequestId: string,
): Promise<PrintingRpcResult<{ assigned_secretary_user_id: string; status: string }>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.claimRequest, {
    p_printing_request_id: printingRequestId,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
}

export async function releasePrintingRequest(
  printingRequestId: string,
): Promise<PrintingRpcResult<{ status: string }>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.releaseRequest, {
    p_printing_request_id: printingRequestId,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
}

export async function transferPrintingRequest(params: {
  printingRequestId: string
  targetSecretaryUserId: string
}): Promise<PrintingRpcResult<{ assigned_secretary_user_id: string }>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.transferRequest, {
    p_printing_request_id: params.printingRequestId,
    p_target_secretary_user_id: params.targetSecretaryUserId,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
}

export async function returnPrintItemForCorrection(params: {
  printItemId: string
  reason: string
}): Promise<PrintingRpcResult<{ item_status: string; request_status: string }>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.returnItemForCorrection, {
    p_print_item_id: params.printItemId,
    p_reason: params.reason,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
}

export async function resubmitPrintItem(params: {
  printItemId: string
  item?: PrintItemInput | null
}): Promise<PrintingRpcResult<{ item_status: string; request_status: string }>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.resubmitItem, {
    p_print_item_id: params.printItemId,
    p_item: params.item ?? null,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
}

export async function rejectPrintItem(params: {
  printItemId: string
  reason: string
}): Promise<PrintingRpcResult<{ item_status: string; request_status: string }>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.rejectItem, {
    p_print_item_id: params.printItemId,
    p_reason: params.reason,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
}

export async function markPrintItemPrinted(
  printItemId: string,
): Promise<PrintingRpcResult<{ item_status: string; request_status: string }>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.markItemPrinted, {
    p_print_item_id: printItemId,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
}

export async function updateInstitutionPrintingSettings(params: {
  minimumPrintNoticeMinutes?: number | null
  deadlineWarningMinutes?: number | null
  fileRetentionDays?: number | null
}): Promise<PrintingRpcResult<{ institution_id: string }>> {
  const { data, error } = await supabase.rpc(PRINTING_RPC.updateInstitutionSettings, {
    p_minimum_print_notice_minutes: params.minimumPrintNoticeMinutes ?? null,
    p_deadline_warning_minutes: params.deadlineWarningMinutes ?? null,
    p_file_retention_days: params.fileRetentionDays ?? null,
  })
  if (error) return { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' }
  return asRpcResult(data)
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
