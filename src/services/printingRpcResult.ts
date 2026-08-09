import type { PrintingErrorCode, PrintingRpcResult } from '../types/printing'
import { isPrintingErrorCode } from '../types/printing'

export type PrintingCreateRequestResult = {
  printing_request_id: string
  request_number: number
  items: Array<{ id: string; storage_object_path: string; display_order: number }>
}

export type PrintingUpdateRequestResult = {
  printing_request_id: string
  status: string
}

export type PrintingStatusResult = {
  status: string
}

export type PrintingClaimRequestResult = {
  assigned_secretary_user_id: string
  status: string
}

export type PrintingTransferRequestResult = {
  assigned_secretary_user_id: string
}

export type PrintingItemStatusResult = {
  item_status: string
  request_status: string
}

export type PrintingInstitutionSettingsResult = {
  institution_id: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizePrintingErrorCode(value: unknown): PrintingErrorCode {
  return isPrintingErrorCode(value) ? value : 'PRINT_REQUEST_UNKNOWN_ERROR'
}

function parseStringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function parseNumberField(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseCreateItems(value: unknown): PrintingCreateRequestResult['items'] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const items: PrintingCreateRequestResult['items'] = []
  for (const entry of value) {
    if (!isRecord(entry)) {
      return null
    }
    const id = parseStringField(entry, 'id')
    const storageObjectPath = parseStringField(entry, 'storage_object_path')
    const displayOrder = parseNumberField(entry, 'display_order')
    if (id === null || storageObjectPath === null || displayOrder === null) {
      return null
    }
    items.push({
      id,
      storage_object_path: storageObjectPath,
      display_order: displayOrder,
    })
  }
  return items
}

export function parsePrintingRpcResult<T extends Record<string, unknown>>(
  data: unknown,
  parseSuccess: (row: Record<string, unknown>) => T | null,
): PrintingRpcResult<T> {
  if (!isRecord(data)) {
    return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
  }

  if (data.ok === true) {
    const success = parseSuccess(data)
    if (success === null) {
      return { ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' }
    }
    return { ok: true, ...success }
  }

  return { ok: false, error_code: normalizePrintingErrorCode(data.error_code) }
}

export function parseCreateRequestResult(
  row: Record<string, unknown>,
): PrintingCreateRequestResult | null {
  const printingRequestId = parseStringField(row, 'printing_request_id')
  const requestNumber = parseNumberField(row, 'request_number')
  const items = parseCreateItems(row.items)
  if (printingRequestId === null || requestNumber === null || items === null) {
    return null
  }
  return {
    printing_request_id: printingRequestId,
    request_number: requestNumber,
    items,
  }
}

export function parseUpdateRequestResult(
  row: Record<string, unknown>,
): PrintingUpdateRequestResult | null {
  const printingRequestId = parseStringField(row, 'printing_request_id')
  const status = parseStringField(row, 'status')
  if (printingRequestId === null || status === null) {
    return null
  }
  return { printing_request_id: printingRequestId, status }
}

export function parseStatusResult(row: Record<string, unknown>): PrintingStatusResult | null {
  const status = parseStringField(row, 'status')
  return status === null ? null : { status }
}

export function parseClaimRequestResult(
  row: Record<string, unknown>,
): PrintingClaimRequestResult | null {
  const assignedSecretaryUserId = parseStringField(row, 'assigned_secretary_user_id')
  const status = parseStringField(row, 'status')
  if (assignedSecretaryUserId === null || status === null) {
    return null
  }
  return { assigned_secretary_user_id: assignedSecretaryUserId, status }
}

export function parseTransferRequestResult(
  row: Record<string, unknown>,
): PrintingTransferRequestResult | null {
  const assignedSecretaryUserId = parseStringField(row, 'assigned_secretary_user_id')
  return assignedSecretaryUserId === null
    ? null
    : { assigned_secretary_user_id: assignedSecretaryUserId }
}

export function parseItemStatusResult(
  row: Record<string, unknown>,
): PrintingItemStatusResult | null {
  const itemStatus = parseStringField(row, 'item_status')
  const requestStatus = parseStringField(row, 'request_status')
  if (itemStatus === null || requestStatus === null) {
    return null
  }
  return { item_status: itemStatus, request_status: requestStatus }
}

export function parseInstitutionSettingsResult(
  row: Record<string, unknown>,
): PrintingInstitutionSettingsResult | null {
  const institutionId = parseStringField(row, 'institution_id')
  return institutionId === null ? null : { institution_id: institutionId }
}
