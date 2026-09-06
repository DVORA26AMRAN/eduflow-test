import { describe, expect, it } from 'vitest'
import {
  advanceNoticeHebrewMessage,
  buildRequiredByIso,
  copySettingsFromPrevious,
  createEmptyDraftItem,
  DEFAULT_PRINT_ITEM_SETTINGS,
  draftItemToInput,
  formatPrintingRequestNumber,
  isPrintingRequestEditable,
  isRequiredByTooLateClient,
  mapPrintingErrorCode,
  moveDraftItem,
  validateDraftItemSettings,
  validatePrintingFileClient,
} from './printingUi'
import { MAX_PRINT_COPIES, MAX_PRINT_FILE_SIZE_BYTES } from '../types/printing'

function makeFile(name: string, type: string, size: number): File {
  const content = size <= 64 ? new Uint8Array(size) : new Uint8Array(64)
  const file = new File([content], name, { type })
  if (size > 64) {
    Object.defineProperty(file, 'size', { value: size })
  }
  return file
}

describe('printingUi Phase 2 contracts', () => {
  it('maps backend error codes to Hebrew and keeps defaults centralized', () => {
    expect(mapPrintingErrorCode('PRINT_REQUEST_TOO_LATE')).toMatch(/מראש/)
    expect(mapPrintingErrorCode('PRINT_REQUEST_SAME_DAY_CLOSED')).toMatch(/היום/)
    expect(mapPrintingErrorCode('PRINT_REQUEST_LOCKED')).toMatch(/הטיפול בבקשה כבר התחיל/)
    expect(mapPrintingErrorCode('PRINT_REQUEST_ALREADY_CLAIMED')).toMatch(/נלקחה לטיפול/)
    expect(mapPrintingErrorCode('SECRETARY_NOT_AUTHORIZED')).toMatch(/מזכירה/)
    expect(mapPrintingErrorCode('PRINT_REQUEST_FORBIDDEN')).toMatch(/הרשאה/)
    expect(mapPrintingErrorCode('PRINT_REQUEST_UNKNOWN_ERROR')).toMatch(/אירעה שגיאה/)
    expect(mapPrintingErrorCode('UNKNOWN' as never)).toMatch(/אירעה שגיאה/)
    expect(mapPrintingErrorCode('PRINT_REQUEST_FORBIDDEN')).not.toBe(
      mapPrintingErrorCode('PRINT_REQUEST_UNKNOWN_ERROR'),
    )
    expect(DEFAULT_PRINT_ITEM_SETTINGS.copies).toBe(1)
    expect(DEFAULT_PRINT_ITEM_SETTINGS.color_mode).toBe('black_and_white')
    expect(DEFAULT_PRINT_ITEM_SETTINGS.collate).toBe(true)
    expect(formatPrintingRequestNumber(1042)).toBe('#1042')
  })

  it('validates files and page/copies/scale settings for the teacher form', () => {
    expect(validatePrintingFileClient(makeFile('a.pdf', 'application/pdf', 10)).ok).toBe(true)
    expect(
      validatePrintingFileClient(makeFile('x.exe', 'application/x-msdownload', 10)).ok,
    ).toBe(false)
    expect(
      validatePrintingFileClient(
        makeFile('big.pdf', 'application/pdf', MAX_PRINT_FILE_SIZE_BYTES + 1),
      ).ok,
    ).toBe(false)

    const item = createEmptyDraftItem(makeFile('a.pdf', 'application/pdf', 10))
    expect(validateDraftItemSettings(item)).toBeNull()
    item.page_selection_mode = 'custom'
    item.page_selection_value = '3-1'
    expect(validateDraftItemSettings(item)).toMatch(/עמודים/)
    item.page_selection_value = '1-3'
    item.copies = MAX_PRINT_COPIES + 1
    expect(validateDraftItemSettings(item)).toMatch(/עותקים/)
    item.copies = 2
    item.sides = 'double_sided'
    item.duplex_flip_mode = null
    expect(validateDraftItemSettings(item)).toMatch(/היפוך/)
  })

  it('copies previous settings without file or notes', () => {
    const first = createEmptyDraftItem(makeFile('a.pdf', 'application/pdf', 10))
    first.copies = 30
    first.color_mode = 'color'
    first.notes = 'אל תעתיק'
    const second = createEmptyDraftItem(makeFile('b.pdf', 'application/pdf', 20))
    const copied = copySettingsFromPrevious(second, first)
    expect(copied.copies).toBe(30)
    expect(copied.color_mode).toBe('color')
    expect(copied.original_filename).toBe('b.pdf')
    expect(copied.notes).toBeNull()
    expect(copied.file).toBe(second.file)
  })

  it('reorders items and builds required_by with institution timezone', () => {
    const a = createEmptyDraftItem(makeFile('a.pdf', 'application/pdf', 10))
    const b = createEmptyDraftItem(makeFile('b.pdf', 'application/pdf', 10))
    const moved = moveDraftItem([a, b], 0, 1)
    expect(moved[0].original_filename).toBe('b.pdf')
    expect(moved[1].original_filename).toBe('a.pdf')

    const iso = buildRequiredByIso({
      date: '2026-08-06',
      time: '11:00',
      timeZone: 'Asia/Jerusalem',
    })
    expect(iso).toBe('2026-08-06T08:00:00.000Z')
    expect(
      isRequiredByTooLateClient({
        requiredByIso: iso!,
        minimumPrintNoticeMinutes: 60,
        now: new Date('2026-08-06T07:30:00.000Z'),
      }),
    ).toBe(true)
    expect(advanceNoticeHebrewMessage(60)).toMatch(/שעה מראש/)
  })

  it('locks edit/cancel after claim and maps draft items to RPC payloads', () => {
    expect(
      isPrintingRequestEditable({
        teacherUserId: 't1',
        actorUserId: 't1',
        assignedSecretaryUserId: null,
        processingStartedAt: null,
        status: 'submitted',
      }),
    ).toBe(true)
    expect(
      isPrintingRequestEditable({
        teacherUserId: 't1',
        actorUserId: 't1',
        assignedSecretaryUserId: 's1',
        processingStartedAt: '2026-08-01T10:00:00.000Z',
        status: 'in_progress',
      }),
    ).toBe(false)

    const item = createEmptyDraftItem(makeFile('a.pdf', 'application/pdf', 10))
    const payload = draftItemToInput(item, 1)
    expect(payload.display_order).toBe(1)
    expect(payload.original_filename).toBe('a.pdf')
    expect(payload.copies).toBe(1)
  })
})
