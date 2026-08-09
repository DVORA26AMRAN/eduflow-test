import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeacherPrintItemCorrectionModal } from './TeacherPrintItemCorrectionModal'

const resubmitPrintItem = vi.fn()
const uploadPrintingFile = vi.fn()

vi.mock('../../../services/printingRequests', () => ({
  resubmitPrintItem: (...args: unknown[]) => resubmitPrintItem(...args),
  uploadPrintingFile: (...args: unknown[]) => uploadPrintingFile(...args),
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
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TeacherPrintItemCorrectionModal', () => {
  it(
    'shows correction reason and resubmits only the returned item settings',
    async () => {
      const user = userEvent.setup({ delay: null })
      const onResubmitted = vi.fn()
      resubmitPrintItem.mockResolvedValue({
        ok: true,
        item_status: 'resubmitted',
        request_status: 'in_progress',
      })

      render(
        <TeacherPrintItemCorrectionModal
          isOpen
          item={{
            id: 'item-2',
            printingRequestId: 'req-1',
            institutionId: 'inst-1',
            original_filename: 'worksheet.pdf',
            detected_file_type: 'application/pdf',
            file_size_bytes: 100,
            storage_object_path: 'inst-1/req-1/item-2/old',
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
            correction_reason: 'הקובץ אינו נפתח. נא להעלות מחדש.',
          }}
          onClose={vi.fn()}
          onResubmitted={onResubmitted}
        />,
      )

      expect(screen.getByText(/סיבת התיקון/)).toHaveTextContent(/אינו נפתח/)
      fireEvent.change(screen.getByLabelText('עותקים'), { target: { value: '5' } })
      await user.click(screen.getByRole('button', { name: 'שליחה מחדש' }))

      await waitFor(() => {
        expect(resubmitPrintItem).toHaveBeenCalledTimes(1)
        expect(resubmitPrintItem.mock.calls[0][0].printItemId).toBe('item-2')
        expect(resubmitPrintItem.mock.calls[0][0].item.copies).toBe(5)
        expect(onResubmitted).toHaveBeenCalled()
      })
      expect(uploadPrintingFile).not.toHaveBeenCalled()
    },
    20000,
  )
})
