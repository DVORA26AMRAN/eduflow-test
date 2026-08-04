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
}): Promise<PrintingRpcResult<{ printing_request_id: string; request_number: number }>> {
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

/** Authorized private file access via storage RLS (no public URLs). */
export async function createPrintingFileSignedUrl(params: {
  storageObjectPath: string
  expiresInSeconds?: number
}) {
  return supabase.storage
    .from('printing-files')
    .createSignedUrl(params.storageObjectPath, params.expiresInSeconds ?? 60)
}
