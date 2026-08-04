import { describe, expect, it } from 'vitest'
import type { InstitutionPrintingRequestRow } from '../services/printingRequests'
import {
  filterSecretaryPrintingRequests,
  formatPrintItemSettingsHebrew,
  getPrintingDeadlineGroup,
  groupActivePrintingRequests,
  institutionLocalDateKey,
  isApproachingPrintingDeadline,
  wasUpdatedAfterSubmission,
} from './secretaryPrinting'
import { mapPrintingErrorCode } from './printingUi'

function makeRow(
  overrides: Partial<InstitutionPrintingRequestRow> &
    Pick<InstitutionPrintingRequestRow, 'id' | 'request_number' | 'required_by' | 'status'>,
): InstitutionPrintingRequestRow {
  return {
    submitted_at: '2026-08-01T08:00:00.000Z',
    updated_at: '2026-08-01T08:00:00.000Z',
    cancelled_at: null,
    processing_started_at: null,
    assigned_secretary_user_id: null,
    teacher_user_id: 't1',
    institution_id: 'inst-1',
    files_purged_at: null,
    teacher_full_name: 'דנה כהן',
    assigned_secretary_full_name: null,
    print_items: [
      {
        id: 'i1',
        status: 'pending',
        original_filename: 'worksheet.pdf',
        display_order: 1,
        detected_file_type: 'application/pdf',
        file_size_bytes: 1000,
        storage_object_path: 'a/b/c',
        page_selection_mode: 'all',
        page_selection_value: null,
        copies: 1,
        color_mode: 'black_and_white',
        paper_size: 'a4',
        orientation: 'portrait',
        sides: 'single_sided',
        duplex_flip_mode: null,
        pages_per_sheet: 1,
        scale_mode: 'fit_to_page',
        custom_scale_percent: null,
        collate: true,
        notes: null,
        correction_reason: null,
        rejection_reason: null,
      },
    ],
    ...overrides,
  }
}

describe('secretaryPrinting Phase 3 contracts', () => {
  it('groups by institution timezone calendar day, not browser locale', () => {
    // 2026-08-05 22:00 UTC = 2026-08-06 01:00 Asia/Jerusalem
    const iso = '2026-08-05T22:00:00.000Z'
    expect(institutionLocalDateKey(iso, 'Asia/Jerusalem')).toBe('2026-08-06')
    expect(institutionLocalDateKey(iso, 'UTC')).toBe('2026-08-05')

    const now = new Date('2026-08-06T06:00:00.000Z') // still Aug 6 in Jerusalem
    expect(getPrintingDeadlineGroup(iso, 'Asia/Jerusalem', now)).toBe('today')
  })

  it('sorts active groups by required_by ascending and separates history', () => {
    const rows = [
      makeRow({
        id: 'later',
        request_number: 3,
        required_by: '2026-08-10T08:00:00.000Z',
        status: 'submitted',
      }),
      makeRow({
        id: 'today-late',
        request_number: 2,
        required_by: '2026-08-06T14:00:00.000Z',
        status: 'submitted',
      }),
      makeRow({
        id: 'today-early',
        request_number: 1,
        required_by: '2026-08-06T08:00:00.000Z',
        status: 'in_progress',
      }),
      makeRow({
        id: 'done',
        request_number: 9,
        required_by: '2026-08-06T08:00:00.000Z',
        status: 'printed',
      }),
    ]
    const now = new Date('2026-08-06T06:00:00.000Z')
    const active = filterSecretaryPrintingRequests({
      requests: rows,
      view: 'active',
      filters: {
        search: '',
        status: 'all',
        assignee: 'all',
        deadlineGroup: 'all',
        overdueOnly: false,
        approachingOnly: false,
      },
      timeZone: 'UTC',
      deadlineWarningMinutes: 30,
      now,
    })
    expect(active.map((r) => r.id)).toEqual(['today-early', 'today-late', 'later'])

    const grouped = groupActivePrintingRequests({
      requests: active,
      timeZone: 'UTC',
      now,
    })
    expect(grouped.today.map((r) => r.id)).toEqual(['today-early', 'today-late'])
    expect(grouped.later.map((r) => r.id)).toEqual(['later'])

    const history = filterSecretaryPrintingRequests({
      requests: rows,
      view: 'history',
      filters: {
        search: '',
        status: 'all',
        assignee: 'all',
        deadlineGroup: 'all',
        overdueOnly: false,
        approachingOnly: false,
      },
      timeZone: 'UTC',
      deadlineWarningMinutes: 30,
      now,
    })
    expect(history.map((r) => r.id)).toEqual(['done'])
  })

  it('searches teacher name, request number, and filename; filters assignee and overdue', () => {
    const now = new Date('2026-08-06T12:00:00.000Z')
    const rows = [
      makeRow({
        id: 'a',
        request_number: 1042,
        required_by: '2026-08-06T10:00:00.000Z',
        status: 'submitted',
        teacher_full_name: 'דנה כהן',
        assigned_secretary_user_id: null,
      }),
      makeRow({
        id: 'b',
        request_number: 2000,
        required_by: '2026-08-06T18:00:00.000Z',
        status: 'in_progress',
        teacher_full_name: 'יוסי לוי',
        assigned_secretary_user_id: 's1',
        assigned_secretary_full_name: 'מירי',
        print_items: [
          {
            ...makeRow({ id: 'x', request_number: 1, required_by: '', status: 'submitted' })
              .print_items![0],
            original_filename: 'exam.docx',
          },
        ],
      }),
    ]

    expect(
      filterSecretaryPrintingRequests({
        requests: rows,
        view: 'active',
        filters: {
          search: '1042',
          status: 'all',
          assignee: 'all',
          deadlineGroup: 'all',
          overdueOnly: false,
          approachingOnly: false,
        },
        timeZone: 'UTC',
        deadlineWarningMinutes: 30,
        now,
      }).map((r) => r.id),
    ).toEqual(['a'])

    expect(
      filterSecretaryPrintingRequests({
        requests: rows,
        view: 'active',
        filters: {
          search: 'exam',
          status: 'all',
          assignee: 'all',
          deadlineGroup: 'all',
          overdueOnly: false,
          approachingOnly: false,
        },
        timeZone: 'UTC',
        deadlineWarningMinutes: 30,
        now,
      }).map((r) => r.id),
    ).toEqual(['b'])

    expect(
      filterSecretaryPrintingRequests({
        requests: rows,
        view: 'active',
        filters: {
          search: '',
          status: 'all',
          assignee: 'unassigned',
          deadlineGroup: 'all',
          overdueOnly: false,
          approachingOnly: false,
        },
        timeZone: 'UTC',
        deadlineWarningMinutes: 30,
        now,
      }).map((r) => r.id),
    ).toEqual(['a'])

    expect(
      filterSecretaryPrintingRequests({
        requests: rows,
        view: 'active',
        filters: {
          search: '',
          status: 'all',
          assignee: 'all',
          deadlineGroup: 'all',
          overdueOnly: true,
          approachingOnly: false,
        },
        timeZone: 'UTC',
        deadlineWarningMinutes: 30,
        now,
      }).map((r) => r.id),
    ).toEqual(['a'])
  })

  it('computes approaching deadline from institution setting and maps secretary errors', () => {
    const requiredBy = new Date('2026-08-06T11:00:00.000Z')
    expect(
      isApproachingPrintingDeadline({
        requiredBy,
        status: 'submitted',
        now: new Date('2026-08-06T10:40:00.000Z'),
        deadlineWarningMinutes: 30,
      }),
    ).toBe(true)
    expect(
      isApproachingPrintingDeadline({
        requiredBy,
        status: 'printed',
        now: new Date('2026-08-06T10:40:00.000Z'),
        deadlineWarningMinutes: 30,
      }),
    ).toBe(false)

    expect(wasUpdatedAfterSubmission({
      submitted_at: '2026-08-01T08:00:00.000Z',
      updated_at: '2026-08-01T09:00:00.000Z',
    })).toBe(true)

    expect(mapPrintingErrorCode('PRINT_REQUEST_ALREADY_CLAIMED')).toMatch(/נלקחה לטיפול/)
    expect(mapPrintingErrorCode('SECRETARY_NOT_AUTHORIZED')).toMatch(/מזכירה/)
    expect(mapPrintingErrorCode('PRINT_FILE_NOT_AVAILABLE')).toMatch(/אינו נשמר/)

    const settings = formatPrintItemSettingsHebrew({
      page_selection_mode: 'custom',
      page_selection_value: '1-3',
      copies: 30,
      color_mode: 'black_and_white',
      paper_size: 'a4',
      orientation: 'portrait',
      sides: 'double_sided',
      duplex_flip_mode: 'long_edge',
      pages_per_sheet: 2,
      scale_mode: 'fit_to_page',
      custom_scale_percent: null,
      collate: true,
    })
    expect(settings).toContain('עמודים 1-3')
    expect(settings).toContain('30 עותקים')
    expect(settings).toContain('שחור-לבן')
    expect(settings).toContain('דו-צדדי')
    expect(settings).toContain('היפוך בצד הארוך')
    expect(settings).not.toContain('double_sided')
  })
})
