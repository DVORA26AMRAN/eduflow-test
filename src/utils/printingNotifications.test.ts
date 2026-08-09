import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  extractPrintingRequestIdFromNotification,
  isPrintItemRetentionEligible,
  isPrintingNotificationType,
  isStaffPrintingNotificationType,
  PRINT_NOTIFICATION_REQUEST_COMPLETED,
  PRINT_NOTIFICATION_REQUEST_OVERDUE,
} from './printingNotifications'
import { mapPrintingErrorCode } from './printingUi'

describe('printing Phase 4 notifications and retention helpers', () => {
  it('recognizes printing notification types and extracts request ids safely', () => {
    expect(isPrintingNotificationType(PRINT_NOTIFICATION_REQUEST_COMPLETED)).toBe(true)
    expect(isPrintingNotificationType('REQUEST_STATUS_CHANGED')).toBe(false)
    expect(isStaffPrintingNotificationType(PRINT_NOTIFICATION_REQUEST_OVERDUE)).toBe(true)
    expect(isStaffPrintingNotificationType(PRINT_NOTIFICATION_REQUEST_COMPLETED)).toBe(false)
    expect(
      extractPrintingRequestIdFromNotification({
        printing_request_id: 'req-1',
        storage_object_path: 'should-not-matter',
      }),
    ).toBe('req-1')
    expect(extractPrintingRequestIdFromNotification({ request_id: 'other' })).toBeNull()
  })

  it('maps Phase 4 error codes and evaluates retention eligibility', () => {
    expect(mapPrintingErrorCode('PRINT_ITEM_NOT_RETURNED')).toMatch(/הוחזר לתיקון/)
    expect(mapPrintingErrorCode('PRINT_RETENTION_NOT_ELIGIBLE')).toMatch(/זכאי/)

    const terminalAt = new Date('2026-01-01T00:00:00.000Z')
    expect(
      isPrintItemRetentionEligible({
        requestStatus: 'printed',
        itemStatus: 'printed',
        filePurgedAt: null,
        storageObjectPath: 'a/b/c',
        terminalAt,
        fileRetentionDays: 90,
        now: new Date('2026-05-01T00:00:00.000Z'),
      }),
    ).toBe(true)

    expect(
      isPrintItemRetentionEligible({
        requestStatus: 'printed',
        itemStatus: 'returned_for_correction',
        filePurgedAt: null,
        storageObjectPath: 'a/b/c',
        terminalAt,
        fileRetentionDays: 90,
        now: new Date('2026-05-01T00:00:00.000Z'),
      }),
    ).toBe(false)

    expect(
      isPrintItemRetentionEligible({
        requestStatus: 'in_progress',
        itemStatus: 'printed',
        filePurgedAt: null,
        storageObjectPath: 'a/b/c',
        terminalAt,
        fileRetentionDays: 90,
        now: new Date('2026-05-01T00:00:00.000Z'),
      }),
    ).toBe(false)
  })
})

describe('printing Phase 4 migration contracts', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20250804200000_printing_requests_phase4.sql'),
    'utf8',
  )

  it('adds printing notification types with dedupe indexes and workers', () => {
    expect(sql).toContain('PRINT_REQUEST_COMPLETED')
    expect(sql).toContain('PRINT_ITEM_RETURNED_FOR_CORRECTION')
    expect(sql).toContain('PRINT_ITEM_REJECTED')
    expect(sql).toContain('PRINT_REQUEST_OVERDUE')
    expect(sql).toContain('notifications_print_completed_uidx')
    expect(sql).toContain('printing_dispatch_overdue_notifications')
    expect(sql).toContain('printing_list_retention_purge_candidates')
    expect(sql).toContain('printing_mark_item_file_purged')
    expect(sql).toContain('overdue_notified_at')
    expect(sql).toContain('file_purged_at')
    expect(sql).toContain('PRINT_ITEM_NOT_RETURNED')
    expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'")
  })

  it('emits completion notification only from mark-printed parent completion path', () => {
    expect(sql).toContain('printing_notify_teacher_request_completed')
    expect(sql).toContain("dedupe_key', 'completed:' || p_req.id::text")
  })
})
