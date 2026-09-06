import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecretaryPrintingWorkspace } from './SecretaryPrintingWorkspace'
import type { InstitutionPrintingRequestRow } from '../../../services/printingRequests'

const listInstitutionPrintingRequests = vi.fn()
const loadInstitutionPrintingSettings = vi.fn()
const claimPrintingRequest = vi.fn()
const markPrintItemPrinted = vi.fn()
const returnPrintItemForCorrection = vi.fn()
const accessPrintingFile = vi.fn()
const listInstitutionSecretariesForTransfer = vi.fn()

vi.mock('../../../services/printingRequests', () => ({
  listInstitutionPrintingRequests: (...args: unknown[]) => listInstitutionPrintingRequests(...args),
  loadInstitutionPrintingSettings: (...args: unknown[]) => loadInstitutionPrintingSettings(...args),
  listInstitutionSecretariesForTransfer: (...args: unknown[]) =>
    listInstitutionSecretariesForTransfer(...args),
  claimPrintingRequest: (...args: unknown[]) => claimPrintingRequest(...args),
  releasePrintingRequest: vi.fn(),
  transferPrintingRequest: vi.fn(),
  markPrintItemPrinted: (...args: unknown[]) => markPrintItemPrinted(...args),
  returnPrintItemForCorrection: (...args: unknown[]) => returnPrintItemForCorrection(...args),
  rejectPrintItem: vi.fn(),
  accessPrintingFile: (...args: unknown[]) => accessPrintingFile(...args),
  updateInstitutionPrintingSettings: vi.fn(),
}))

vi.mock('../../ui/Modal', () => ({
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean
    title: string
    children: React.ReactNode
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  ConfirmDialog: ({
    isOpen,
    title,
    confirmLabel,
    onConfirm,
  }: {
    isOpen: boolean
    title: string
    confirmLabel: string
    onConfirm: () => void
  }) =>
    isOpen ? (
      <div role="alertdialog" aria-label={title}>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function item(
  overrides: Partial<NonNullable<InstitutionPrintingRequestRow['print_items']>[number]> & {
    id: string
    original_filename: string
    display_order: number
    status: string
  },
): NonNullable<InstitutionPrintingRequestRow['print_items']>[number] {
  return {
    detected_file_type: 'application/pdf',
    file_size_bytes: 1200,
    storage_object_path: `path/${overrides.id}`,
    page_selection_mode: 'all',
    page_selection_value: null,
    copies: 2,
    color_mode: 'black_and_white',
    paper_size: 'a4',
    orientation: 'portrait',
    sides: 'single_sided',
    duplex_flip_mode: null,
    pages_per_sheet: 1,
    scale_mode: 'fit_to_page',
    custom_scale_percent: null,
    collate: true,
    notes: 'נא לשדך',
    correction_reason: null,
    rejection_reason: null,
    ...overrides,
  }
}

function baseRequest(
  overrides: Partial<InstitutionPrintingRequestRow> = {},
): InstitutionPrintingRequestRow {
  return {
    id: 'req-1',
    request_number: 1042,
    required_by: '2099-08-06T08:00:00.000Z',
    status: 'submitted',
    submitted_at: '2099-08-05T08:00:00.000Z',
    updated_at: '2099-08-05T08:00:00.000Z',
    cancelled_at: null,
    processing_started_at: null,
    assigned_secretary_user_id: null,
    teacher_user_id: 'teacher-1',
    institution_id: 'inst-1',
    files_purged_at: null,
    teacher_full_name: 'דנה כהן',
    assigned_secretary_full_name: null,
    print_items: [
      item({ id: 'i1', original_filename: 'worksheet.pdf', display_order: 1, status: 'pending' }),
      item({ id: 'i2', original_filename: 'cover.png', display_order: 2, status: 'pending' }),
    ],
    ...overrides,
  }
}

function mockDefaults(requests: InstitutionPrintingRequestRow[]) {
  listInstitutionPrintingRequests.mockResolvedValue({ ok: true, requests })
  loadInstitutionPrintingSettings.mockResolvedValue({
    ok: true,
    minimumPrintNoticeMinutes: 60,
    deadlineWarningMinutes: 30,
    fileRetentionDays: 90,
    timeZone: 'UTC',
    printSubmissionPolicyMode: 'relative_notice',
    printDailyCutoffLocalTime: null,
  })
  listInstitutionSecretariesForTransfer.mockResolvedValue({
    ok: true,
    secretaries: [
      { id: 'sec-1', fullName: 'מזכירה א' },
      { id: 'sec-2', fullName: 'מזכירה ב' },
    ],
  })
  accessPrintingFile.mockResolvedValue({ ok: true, signedUrl: 'https://signed.example/file' })
}

describe('SecretaryPrintingWorkspace', () => {
  it('shows printing submission policy settings after settings load', async () => {
    mockDefaults([])
    render(
      <div dir="rtl">
        <SecretaryPrintingWorkspace
          actorUserId="sec-1"
          institutionId="inst-1"
          institutionTimeZone="UTC"
        />
      </div>,
    )

    expect(
      await screen.findByTestId('printing-submission-policy-settings'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: 'כמה זמן מראש מורות צריכות לשלוח להדפסה?',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'שעה מראש' })).toBeChecked()
  })

  it(
    'opens without claiming, claims via Start Processing, Print does not mark printed, Mark as Printed completes into History',
    async () => {
      const user = userEvent.setup({ delay: null })
      mockDefaults([baseRequest()])
      claimPrintingRequest.mockResolvedValue({
        ok: true,
        assigned_secretary_user_id: 'sec-1',
        status: 'in_progress',
      })

      render(
        <div dir="rtl">
          <SecretaryPrintingWorkspace
            actorUserId="sec-1"
            institutionId="inst-1"
            institutionTimeZone="UTC"
          />
        </div>,
      )

      await waitFor(() => expect(screen.getByText('#1042')).toBeInTheDocument())
      expect(screen.getByRole('heading', { name: /היום/ })).toBeInTheDocument()
      expect(claimPrintingRequest).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'פרטים' }))
      const details = await screen.findByRole('dialog', { name: /בקשת הדפסה #1042/ })
      expect(within(details).getByText(/worksheet\.pdf/)).toBeInTheDocument()
      expect(within(details).getAllByText(/נא לשדך/).length).toBeGreaterThan(0)
      expect(claimPrintingRequest).not.toHaveBeenCalled()
      expect(within(details).queryByText(/path\//)).not.toBeInTheDocument()

      const claimed = baseRequest({
        status: 'in_progress',
        assigned_secretary_user_id: 'sec-1',
        assigned_secretary_full_name: 'מזכירה א',
        processing_started_at: '2099-08-05T09:00:00.000Z',
        print_items: [
          item({
            id: 'i1',
            original_filename: 'worksheet.pdf',
            display_order: 1,
            status: 'processing',
          }),
          item({
            id: 'i2',
            original_filename: 'cover.png',
            display_order: 2,
            status: 'processing',
          }),
        ],
      })
      listInstitutionPrintingRequests.mockResolvedValue({ ok: true, requests: [claimed] })
      await user.click(within(details).getByRole('button', { name: 'התחלתי לטפל' }))
      await waitFor(() => expect(claimPrintingRequest).toHaveBeenCalledWith('req-1'))
      await waitFor(() => {
        expect(screen.getAllByText(/בטיפול של מזכירה א/).length).toBeGreaterThan(0)
      })

      await user.click(within(details).getAllByRole('button', { name: 'הדפסה' })[0])
      await waitFor(() => expect(accessPrintingFile).toHaveBeenCalled())
      expect(markPrintItemPrinted).not.toHaveBeenCalled()

      markPrintItemPrinted.mockResolvedValueOnce({
        ok: true,
        item_status: 'printed',
        request_status: 'in_progress',
      })
      listInstitutionPrintingRequests.mockResolvedValue({
        ok: true,
        requests: [
          baseRequest({
            status: 'in_progress',
            assigned_secretary_user_id: 'sec-1',
            assigned_secretary_full_name: 'מזכירה א',
            print_items: [
              item({
                id: 'i1',
                original_filename: 'worksheet.pdf',
                display_order: 1,
                status: 'printed',
              }),
              item({
                id: 'i2',
                original_filename: 'cover.png',
                display_order: 2,
                status: 'processing',
              }),
            ],
          }),
        ],
      })
      await user.click(within(details).getAllByRole('button', { name: 'סמן כהודפס' })[0])
      const confirmPrinted = await screen.findByRole('alertdialog', { name: 'סמן כהודפס' })
      await user.click(within(confirmPrinted).getByRole('button', { name: 'סמן כהודפס' }))
      await waitFor(() => expect(markPrintItemPrinted).toHaveBeenCalledWith('i1'))

      markPrintItemPrinted.mockResolvedValueOnce({
        ok: true,
        item_status: 'printed',
        request_status: 'printed',
      })
      listInstitutionPrintingRequests.mockResolvedValue({
        ok: true,
        requests: [
          baseRequest({
            status: 'printed',
            assigned_secretary_user_id: 'sec-1',
            assigned_secretary_full_name: 'מזכירה א',
            print_items: [
              item({
                id: 'i1',
                original_filename: 'worksheet.pdf',
                display_order: 1,
                status: 'printed',
              }),
              item({
                id: 'i2',
                original_filename: 'cover.png',
                display_order: 2,
                status: 'printed',
              }),
            ],
          }),
        ],
      })
      await user.click(within(details).getAllByRole('button', { name: 'סמן כהודפס' })[0])
      const confirmPrinted2 = await screen.findByRole('alertdialog', { name: 'סמן כהודפס' })
      await user.click(within(confirmPrinted2).getByRole('button', { name: 'סמן כהודפס' }))
      await waitFor(() => expect(markPrintItemPrinted).toHaveBeenCalledWith('i2'))

      await user.click(screen.getByRole('tab', { name: /היסטוריה/ }))
      await waitFor(() => expect(screen.getByText('#1042')).toBeInTheDocument())
    },
    30000,
  )

  it(
    'maps already-claimed conflict and returns one item for correction while keeping others processable',
    async () => {
      const user = userEvent.setup({ delay: null })
      mockDefaults([baseRequest()])
      claimPrintingRequest.mockResolvedValue({
        ok: false,
        error_code: 'PRINT_REQUEST_ALREADY_CLAIMED',
      })

      render(
        <div dir="rtl">
          <SecretaryPrintingWorkspace
            actorUserId="sec-1"
            institutionId="inst-1"
            institutionTimeZone="UTC"
          />
        </div>,
      )

      await waitFor(() => expect(screen.getByText('#1042')).toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'פרטים' }))
      const details = await screen.findByRole('dialog', { name: /בקשת הדפסה #1042/ })

      listInstitutionPrintingRequests.mockResolvedValue({
        ok: true,
        requests: [
          baseRequest({
            status: 'in_progress',
            assigned_secretary_user_id: 'sec-2',
            assigned_secretary_full_name: 'מזכירה ב',
          }),
        ],
      })
      await user.click(within(details).getByRole('button', { name: 'התחלתי לטפל' }))
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/נלקחה לטיפול/)
      })

      cleanup()
      const mine = baseRequest({
        status: 'in_progress',
        assigned_secretary_user_id: 'sec-1',
        assigned_secretary_full_name: 'מזכירה א',
        print_items: [
          item({
            id: 'i1',
            original_filename: 'worksheet.pdf',
            display_order: 1,
            status: 'processing',
          }),
          item({
            id: 'i2',
            original_filename: 'cover.png',
            display_order: 2,
            status: 'processing',
          }),
        ],
      })
      mockDefaults([mine])
      render(
        <div dir="rtl">
          <SecretaryPrintingWorkspace
            actorUserId="sec-1"
            institutionId="inst-1"
            institutionTimeZone="UTC"
          />
        </div>,
      )
      await waitFor(() => expect(screen.getByText('#1042')).toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'פרטים' }))
      const mineDetails = await screen.findByRole('dialog', { name: /בקשת הדפסה #1042/ })

      returnPrintItemForCorrection.mockResolvedValue({
        ok: true,
        item_status: 'returned_for_correction',
        request_status: 'needs_correction',
      })
      listInstitutionPrintingRequests.mockResolvedValue({
        ok: true,
        requests: [
          baseRequest({
            status: 'needs_correction',
            assigned_secretary_user_id: 'sec-1',
            assigned_secretary_full_name: 'מזכירה א',
            print_items: [
              item({
                id: 'i1',
                original_filename: 'worksheet.pdf',
                display_order: 1,
                status: 'returned_for_correction',
                correction_reason: 'חסרים עמודים',
              }),
              item({
                id: 'i2',
                original_filename: 'cover.png',
                display_order: 2,
                status: 'processing',
              }),
            ],
          }),
        ],
      })

      await user.click(within(mineDetails).getAllByRole('button', { name: 'החזר לתיקון' })[0])
      const reasonDialog = await screen.findByRole('dialog', { name: 'החזרה לתיקון' })
      await user.type(within(reasonDialog).getByLabelText('סיבה לפעולה'), 'חסרים עמודים')
      await user.click(within(reasonDialog).getByRole('button', { name: 'אישור' }))

      await waitFor(() => {
        expect(returnPrintItemForCorrection).toHaveBeenCalledWith({
          printItemId: 'i1',
          reason: 'חסרים עמודים',
        })
      })
      await waitFor(() => {
        expect(screen.getAllByText(/הוחזר לתיקון/).length).toBeGreaterThan(0)
        expect(screen.getByText(/סיבת תיקון: חסרים עמודים/)).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: 'סמן כהודפס' }).length).toBeGreaterThan(0)
      })
    },
    30000,
  )

  it('opens focused request details from notification deep link without claiming', async () => {
    const onFocusRequestConsumed = vi.fn()
    mockDefaults([baseRequest({ id: 'req-focus', request_number: 2042 })])

    render(
      <div dir="rtl">
        <SecretaryPrintingWorkspace
          actorUserId="sec-1"
          institutionId="inst-1"
          institutionTimeZone="UTC"
          focusRequestId="req-focus"
          onFocusRequestConsumed={onFocusRequestConsumed}
        />
      </div>,
    )

    const details = await screen.findByRole('dialog', { name: /בקשת הדפסה #2042/ })
    expect(within(details).getByText(/worksheet\.pdf/)).toBeInTheDocument()
    expect(claimPrintingRequest).not.toHaveBeenCalled()
    await waitFor(() => expect(onFocusRequestConsumed).toHaveBeenCalled())
  })
})
