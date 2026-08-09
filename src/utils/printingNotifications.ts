/** Printing Phase 4 notification contracts (machine-readable). */

export const PRINT_NOTIFICATION_REQUEST_COMPLETED = 'PRINT_REQUEST_COMPLETED' as const
export const PRINT_NOTIFICATION_ITEM_RETURNED = 'PRINT_ITEM_RETURNED_FOR_CORRECTION' as const
export const PRINT_NOTIFICATION_ITEM_REJECTED = 'PRINT_ITEM_REJECTED' as const
export const PRINT_NOTIFICATION_REQUEST_OVERDUE = 'PRINT_REQUEST_OVERDUE' as const

export type PrintingNotificationType =
  | typeof PRINT_NOTIFICATION_REQUEST_COMPLETED
  | typeof PRINT_NOTIFICATION_ITEM_RETURNED
  | typeof PRINT_NOTIFICATION_ITEM_REJECTED
  | typeof PRINT_NOTIFICATION_REQUEST_OVERDUE

export const PRINTING_NOTIFICATION_TYPES: PrintingNotificationType[] = [
  PRINT_NOTIFICATION_REQUEST_COMPLETED,
  PRINT_NOTIFICATION_ITEM_RETURNED,
  PRINT_NOTIFICATION_ITEM_REJECTED,
  PRINT_NOTIFICATION_REQUEST_OVERDUE,
]

export function isPrintingNotificationType(value: string): value is PrintingNotificationType {
  return (PRINTING_NOTIFICATION_TYPES as string[]).includes(value)
}

/** Secretary/manager printing notifications (teachers receive the other types). */
export function isStaffPrintingNotificationType(value: string): boolean {
  return value === PRINT_NOTIFICATION_REQUEST_OVERDUE
}

export function extractPrintingRequestIdFromNotification(metadata: Record<string, unknown>): string | null {
  const id = metadata.printing_request_id
  return typeof id === 'string' ? id : null
}

export function extractPrintItemIdFromNotification(metadata: Record<string, unknown>): string | null {
  const id = metadata.print_item_id
  return typeof id === 'string' ? id : null
}

/** Retention clock starts at terminal request timestamp (completion/cancel/reject). */
export function isPrintItemRetentionEligible(params: {
  requestStatus: string
  itemStatus: string
  filePurgedAt: string | null | undefined
  storageObjectPath: string | null | undefined
  terminalAt: Date
  fileRetentionDays: number
  now?: Date
}): boolean {
  if (!['printed', 'cancelled', 'rejected'].includes(params.requestStatus)) return false
  if (params.filePurgedAt) return false
  if (!params.storageObjectPath) return false
  if (['returned_for_correction', 'resubmitted', 'pending', 'processing'].includes(params.itemStatus)) {
    return false
  }
  const now = params.now ?? new Date()
  const ms = params.fileRetentionDays * 24 * 60 * 60 * 1000
  return now.getTime() - params.terminalAt.getTime() >= ms
}
