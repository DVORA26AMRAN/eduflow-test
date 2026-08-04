import { describe, expect, it } from 'vitest'
import {
  attemptSecretaryClaim,
  canAccessPrintingFile,
  canReadPrintingRequest,
  canTeacherEditOrCancel,
  canTransferToSecretary,
  derivePrintingParentStatus,
  isPrintItemTransitionAllowed,
  simulateConcurrentClaims,
} from './lifecycle'
import {
  isAllowedPrintingMimeType,
  isPrintingRequestOverdue,
  isPrintingRequestTooLate,
  isValidPageSelection,
  requiredByFromInstitutionLocal,
  validatePrintItemCount,
  validatePrintItemInput,
} from './validation'
import {
  MAX_PRINT_COPIES,
  MAX_PRINT_FILE_SIZE_BYTES,
  MAX_PRINT_ITEMS_PER_REQUEST,
} from '../../types/printing'

const baseItem = {
  original_filename: 'worksheet.pdf',
  detected_file_type: 'application/pdf',
  file_size_bytes: 1024,
}

describe('printing file validation', () => {
  it('rejects files over 50 MB and empty sizes', () => {
    expect(
      validatePrintItemInput({
        ...baseItem,
        file_size_bytes: MAX_PRINT_FILE_SIZE_BYTES + 1,
      }),
    ).toBe('PRINT_FILE_TOO_LARGE')
    expect(validatePrintItemInput({ ...baseItem, file_size_bytes: 0 })).toBe(
      'INVALID_PRINT_SETTINGS',
    )
  })

  it('rejects unsupported and executable-like MIME types', () => {
    expect(isAllowedPrintingMimeType('application/x-msdownload')).toBe(false)
    expect(isAllowedPrintingMimeType('application/zip')).toBe(false)
    expect(isAllowedPrintingMimeType('application/javascript')).toBe(false)
    expect(
      validatePrintItemInput({ ...baseItem, detected_file_type: 'application/zip' }),
    ).toBe('PRINT_FILE_TYPE_NOT_ALLOWED')
    expect(isAllowedPrintingMimeType('application/pdf')).toBe(true)
    expect(isAllowedPrintingMimeType('image/heic')).toBe(true)
  })

  it('enforces 1–10 item limits', () => {
    expect(validatePrintItemCount(0)).toBe('INVALID_PRINT_SETTINGS')
    expect(validatePrintItemCount(1)).toBeNull()
    expect(validatePrintItemCount(MAX_PRINT_ITEMS_PER_REQUEST)).toBeNull()
    expect(validatePrintItemCount(MAX_PRINT_ITEMS_PER_REQUEST + 1)).toBe(
      'PRINT_ITEM_LIMIT_EXCEEDED',
    )
  })

  it('validates page selection, copies, duplex, and scale settings', () => {
    expect(isValidPageSelection('all', null)).toBe(true)
    expect(isValidPageSelection('custom', '1-3')).toBe(true)
    expect(isValidPageSelection('custom', '1,3,5')).toBe(true)
    expect(isValidPageSelection('custom', '2-4,7')).toBe(true)
    expect(isValidPageSelection('custom', '3-1')).toBe(false)
    expect(isValidPageSelection('custom', 'abc')).toBe(false)
    expect(isValidPageSelection('custom', '')).toBe(false)

    expect(validatePrintItemInput({ ...baseItem, copies: 0 })).toBe('INVALID_PRINT_SETTINGS')
    expect(validatePrintItemInput({ ...baseItem, copies: -1 })).toBe('INVALID_PRINT_SETTINGS')
    expect(validatePrintItemInput({ ...baseItem, copies: MAX_PRINT_COPIES + 1 })).toBe(
      'INVALID_PRINT_SETTINGS',
    )
    expect(
      validatePrintItemInput({
        ...baseItem,
        sides: 'double_sided',
        duplex_flip_mode: 'long_edge',
      }),
    ).toBeNull()
    expect(
      validatePrintItemInput({
        ...baseItem,
        sides: 'double_sided',
        duplex_flip_mode: null,
      }),
    ).toBe('INVALID_PRINT_SETTINGS')
    expect(
      validatePrintItemInput({
        ...baseItem,
        scale_mode: 'custom',
        custom_scale_percent: 85,
      }),
    ).toBeNull()
    expect(
      validatePrintItemInput({
        ...baseItem,
        scale_mode: 'custom',
        custom_scale_percent: null,
      }),
    ).toBe('INVALID_PRINT_SETTINGS')
  })
})

describe('printing advance-notice cutoff (institution timezone)', () => {
  it('accepts submissions before cutoff and rejects after', () => {
    const requiredBy = new Date('2026-08-04T11:00:00.000Z')
    const notice = 60
    expect(
      isPrintingRequestTooLate({
        requiredBy,
        now: new Date('2026-08-04T09:59:59.000Z'),
        minimumPrintNoticeMinutes: notice,
      }),
    ).toBe(false)
    expect(
      isPrintingRequestTooLate({
        requiredBy,
        now: new Date('2026-08-04T10:00:00.000Z'),
        minimumPrintNoticeMinutes: notice,
      }),
    ).toBe(false)
    expect(
      isPrintingRequestTooLate({
        requiredBy,
        now: new Date('2026-08-04T10:00:00.001Z'),
        minimumPrintNoticeMinutes: notice,
      }),
    ).toBe(true)
  })

  it('handles cross-day deadlines via institution timezone conversion', () => {
    // Asia/Jerusalem summer: UTC+3 → 01:00 local next day is previous day 22:00 UTC
    const requiredBy = requiredByFromInstitutionLocal({
      year: 2026,
      month: 8,
      day: 2,
      hour: 1,
      minute: 0,
      timeZone: 'Asia/Jerusalem',
    })
    expect(requiredBy.toISOString()).toBe('2026-08-01T22:00:00.000Z')

    const notice = 60
    expect(
      isPrintingRequestTooLate({
        requiredBy,
        now: new Date('2026-08-01T20:59:00.000Z'),
        minimumPrintNoticeMinutes: notice,
      }),
    ).toBe(false)
    expect(
      isPrintingRequestTooLate({
        requiredBy,
        now: new Date('2026-08-01T21:01:00.000Z'),
        minimumPrintNoticeMinutes: notice,
      }),
    ).toBe(true)
  })

  it('resolves DST spring-forward boundary in Asia/Jerusalem without hardcoding offsets in callers', () => {
    // 2026-03-27 02:00 local does not exist (clocks jump 02:00→03:00). 03:30 local is UTC 00:30.
    const afterSpringForward = requiredByFromInstitutionLocal({
      year: 2026,
      month: 3,
      day: 27,
      hour: 3,
      minute: 30,
      timeZone: 'Asia/Jerusalem',
    })
    expect(afterSpringForward.toISOString()).toBe('2026-03-27T00:30:00.000Z')

    const beforeSpringForward = requiredByFromInstitutionLocal({
      year: 2026,
      month: 3,
      day: 26,
      hour: 12,
      minute: 0,
      timeZone: 'Asia/Jerusalem',
    })
    // Winter offset UTC+2
    expect(beforeSpringForward.toISOString()).toBe('2026-03-26T10:00:00.000Z')
  })

  it('marks overdue without changing ownership semantics', () => {
    expect(
      isPrintingRequestOverdue({
        requiredBy: new Date('2026-08-01T10:00:00.000Z'),
        status: 'in_progress',
        now: new Date('2026-08-01T10:00:01.000Z'),
      }),
    ).toBe(true)
    expect(
      isPrintingRequestOverdue({
        requiredBy: new Date('2026-08-01T10:00:00.000Z'),
        status: 'printed',
        now: new Date('2026-08-01T11:00:00.000Z'),
      }),
    ).toBe(false)
  })
})

describe('printing lifecycle and parent status', () => {
  it('allows valid item transitions and rejects printed → pending', () => {
    expect(isPrintItemTransitionAllowed('pending', 'processing')).toBe(true)
    expect(isPrintItemTransitionAllowed('processing', 'printed')).toBe(true)
    expect(isPrintItemTransitionAllowed('returned_for_correction', 'resubmitted')).toBe(true)
    expect(isPrintItemTransitionAllowed('printed', 'pending')).toBe(false)
    expect(isPrintItemTransitionAllowed('rejected', 'processing')).toBe(false)
  })

  it('derives parent status from items', () => {
    expect(
      derivePrintingParentStatus({
        parentStatus: 'in_progress',
        assignedSecretaryUserId: 'sec-1',
        items: [{ status: 'printed' }, { status: 'processing' }],
      }),
    ).toBe('in_progress')

    expect(
      derivePrintingParentStatus({
        parentStatus: 'in_progress',
        assignedSecretaryUserId: 'sec-1',
        items: [{ status: 'printed' }, { status: 'returned_for_correction' }],
      }),
    ).toBe('needs_correction')

    expect(
      derivePrintingParentStatus({
        parentStatus: 'in_progress',
        assignedSecretaryUserId: 'sec-1',
        items: [{ status: 'printed' }, { status: 'printed' }],
      }),
    ).toBe('printed')
  })

  it('locks teacher edit/cancel after claim', () => {
    expect(
      canTeacherEditOrCancel({
        teacherUserId: 't1',
        actorUserId: 't1',
        assignedSecretaryUserId: null,
        processingStartedAt: null,
        status: 'submitted',
      }),
    ).toBe(true)
    expect(
      canTeacherEditOrCancel({
        teacherUserId: 't1',
        actorUserId: 't1',
        assignedSecretaryUserId: 's1',
        processingStartedAt: '2026-08-01T10:00:00.000Z',
        status: 'in_progress',
      }),
    ).toBe(false)
  })
})

describe('printing authorization isolation', () => {
  it('isolates teachers from each other', () => {
    expect(
      canReadPrintingRequest({
        actorRole: 'teacher',
        actorUserId: 'teacher-a',
        actorInstitutionId: 'inst-1',
        teacherUserId: 'teacher-b',
        requestInstitutionId: 'inst-1',
      }),
    ).toBe(false)
    expect(
      canAccessPrintingFile({
        actorRole: 'teacher',
        actorUserId: 'teacher-a',
        actorInstitutionId: 'inst-1',
        teacherUserId: 'teacher-b',
        requestInstitutionId: 'inst-1',
      }),
    ).toBe(false)
  })

  it('isolates institutions for staff', () => {
    expect(
      canReadPrintingRequest({
        actorRole: 'secretary',
        actorUserId: 'sec-a',
        actorInstitutionId: 'inst-a',
        teacherUserId: 'teacher-1',
        requestInstitutionId: 'inst-b',
      }),
    ).toBe(false)
    expect(
      canAccessPrintingFile({
        actorRole: 'institution_manager',
        actorUserId: 'mgr-a',
        actorInstitutionId: 'inst-a',
        teacherUserId: 'teacher-1',
        requestInstitutionId: 'inst-b',
      }),
    ).toBe(false)
  })
})

describe('printing concurrent claim and transfer', () => {
  it('allows exactly one concurrent claim to succeed', () => {
    const { first, second } = simulateConcurrentClaims(
      { assignedSecretaryUserId: null, status: 'submitted' },
      'secretary-a',
      'secretary-b',
    )
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error_code).toBe('PRINT_REQUEST_ALREADY_CLAIMED')
    if (first.ok) expect(first.state.assignedSecretaryUserId).toBe('secretary-a')
  })

  it('returns already-claimed when a second secretary attempts after assignment', () => {
    const result = attemptSecretaryClaim(
      { assignedSecretaryUserId: 'secretary-a', status: 'in_progress' },
      'secretary-b',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error_code).toBe('PRINT_REQUEST_ALREADY_CLAIMED')
  })

  it('accepts same-institution secretary transfer and rejects cross-institution', () => {
    expect(
      canTransferToSecretary({
        targetRole: 'secretary',
        targetStatus: 'active',
        targetInstitutionId: 'inst-1',
        requestInstitutionId: 'inst-1',
      }),
    ).toEqual({ ok: true })
    expect(
      canTransferToSecretary({
        targetRole: 'teacher',
        targetStatus: 'active',
        targetInstitutionId: 'inst-1',
        requestInstitutionId: 'inst-1',
      }),
    ).toEqual({ ok: false, error_code: 'SECRETARY_NOT_AUTHORIZED' })
    expect(
      canTransferToSecretary({
        targetRole: 'secretary',
        targetStatus: 'active',
        targetInstitutionId: 'inst-2',
        requestInstitutionId: 'inst-1',
      }),
    ).toEqual({ ok: false, error_code: 'CROSS_INSTITUTION_ACCESS_DENIED' })
  })
})
