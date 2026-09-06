import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrintingSubmissionPolicySettings } from './PrintingSubmissionPolicySettings'
import type { PrintingSubmissionPolicySavedState } from '../../../utils/printingSubmissionPolicy'

const updateInstitutionPrintingSettings = vi.fn()

vi.mock('../../../services/printingRequests', () => ({
  updateInstitutionPrintingSettings: (...args: unknown[]) =>
    updateInstitutionPrintingSettings(...args),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const baseSaved: PrintingSubmissionPolicySavedState = {
  mode: 'relative_notice',
  noticeMinutes: 60,
  cutoffLocalTime: null,
  timeZone: 'Asia/Jerusalem',
}

function renderPanel(saved: PrintingSubmissionPolicySavedState = baseSaved) {
  const onSaved = vi.fn()
  render(
    <div dir="rtl">
      <PrintingSubmissionPolicySettings saved={saved} onSaved={onSaved} />
    </div>,
  )
  return { onSaved }
}

describe('PrintingSubmissionPolicySettings', () => {
  it('reconstructs one-hour preset and does not save on open', async () => {
    renderPanel()
    expect(screen.getByRole('radio', { name: 'שעה מראש' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'שמירת מדיניות שליחה' })).toBeDisabled()
    expect(updateInstitutionPrintingSettings).not.toHaveBeenCalled()
    expect(screen.getByText('אין שינויים לשמירה')).toBeInTheDocument()
  })

  it('saves a 30-minute preset as relative_notice with cutoff null', async () => {
    const user = userEvent.setup({ delay: null })
    const { onSaved } = renderPanel()
    updateInstitutionPrintingSettings.mockResolvedValue({ ok: true, institution_id: 'inst-1' })

    await user.click(screen.getByRole('radio', { name: '30 דקות מראש' }))
    await user.click(screen.getByRole('button', { name: 'שמירת מדיניות שליחה' }))

    await waitFor(() => expect(updateInstitutionPrintingSettings).toHaveBeenCalledTimes(1))
    expect(updateInstitutionPrintingSettings).toHaveBeenCalledWith({
      printSubmissionPolicyMode: 'relative_notice',
      minimumPrintNoticeMinutes: 30,
      printDailyCutoffLocalTime: null,
    })
    expect(onSaved).toHaveBeenCalledWith({
      mode: 'relative_notice',
      noticeMinutes: 30,
      cutoffLocalTime: null,
      timeZone: 'Asia/Jerusalem',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/נשמרה/)
  })

  it('saves custom hours/minutes as total minutes', async () => {
    const user = userEvent.setup({ delay: null })
    renderPanel({
      mode: 'relative_notice',
      noticeMinutes: 90,
      cutoffLocalTime: null,
      timeZone: 'UTC',
    })
    updateInstitutionPrintingSettings.mockResolvedValue({ ok: true, institution_id: 'inst-1' })

    expect(screen.getByRole('radio', { name: 'זמן אחר' })).toBeChecked()
    const hours = screen.getByLabelText('שעות')
    const minutes = screen.getByLabelText('דקות')
    await user.clear(hours)
    await user.type(hours, '2')
    await user.clear(minutes)
    await user.type(minutes, '15')
    await user.click(screen.getByRole('button', { name: 'שמירת מדיניות שליחה' }))

    await waitFor(() =>
      expect(updateInstitutionPrintingSettings).toHaveBeenCalledWith({
        printSubmissionPolicyMode: 'relative_notice',
        minimumPrintNoticeMinutes: 135,
        printDailyCutoffLocalTime: null,
      }),
    )
  })

  it('rejects invalid custom range client-side without RPC', async () => {
    const user = userEvent.setup({ delay: null })
    renderPanel({
      mode: 'relative_notice',
      noticeMinutes: 90,
      cutoffLocalTime: null,
      timeZone: 'UTC',
    })

    const hours = screen.getByLabelText('שעות')
    await user.clear(hours)
    await user.type(hours, '200')
    await user.click(screen.getByRole('button', { name: 'שמירת מדיניות שליחה' }))

    expect(updateInstitutionPrintingSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/7 ימים/)
  })

  it('reconstructs daily cutoff and submits local TIME while preserving notice', async () => {
    const user = userEvent.setup({ delay: null })
    renderPanel({
      mode: 'daily_cutoff',
      noticeMinutes: 120,
      cutoffLocalTime: '08:00:00',
      timeZone: 'Asia/Jerusalem',
    })
    updateInstitutionPrintingSettings.mockResolvedValue({ ok: true, institution_id: 'inst-1' })

    expect(screen.getByRole('radio', { name: 'עד שעה קבועה באותו יום' })).toBeChecked()
    expect(screen.getByLabelText('שעת חתך לפי שעון המוסד')).toHaveValue('08:00')
    expect(screen.getByText(/לאחר שעה זו לא ניתן לשלוח בקשת הדפסה להיום/)).toBeInTheDocument()

    await user.clear(screen.getByLabelText('שעת חתך לפי שעון המוסד'))
    await user.type(screen.getByLabelText('שעת חתך לפי שעון המוסד'), '09:30')
    await user.click(screen.getByRole('button', { name: 'שמירת מדיניות שליחה' }))

    await waitFor(() =>
      expect(updateInstitutionPrintingSettings).toHaveBeenCalledWith({
        printSubmissionPolicyMode: 'daily_cutoff',
        minimumPrintNoticeMinutes: 120,
        printDailyCutoffLocalTime: '09:30:00',
      }),
    )
  })

  it('switching daily to relative sends cutoff NULL', async () => {
    const user = userEvent.setup({ delay: null })
    renderPanel({
      mode: 'daily_cutoff',
      noticeMinutes: 60,
      cutoffLocalTime: '08:00:00',
      timeZone: 'UTC',
    })
    updateInstitutionPrintingSettings.mockResolvedValue({ ok: true, institution_id: 'inst-1' })

    await user.click(screen.getByRole('radio', { name: 'שעתיים מראש' }))
    await user.click(screen.getByRole('button', { name: 'שמירת מדיניות שליחה' }))

    await waitFor(() =>
      expect(updateInstitutionPrintingSettings).toHaveBeenCalledWith({
        printSubmissionPolicyMode: 'relative_notice',
        minimumPrintNoticeMinutes: 120,
        printDailyCutoffLocalTime: null,
      }),
    )
  })

  it('prevents duplicate submit while saving and preserves form on RPC error', async () => {
    const user = userEvent.setup({ delay: null })
    let resolveSave: ((value: unknown) => void) | null = null
    updateInstitutionPrintingSettings.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )

    renderPanel()
    await user.click(screen.getByRole('radio', { name: '3 שעות מראש' }))
    const saveButton = screen.getByRole('button', { name: 'שמירת מדיניות שליחה' })
    await user.click(saveButton)
    expect(saveButton).toBeDisabled()
    await user.click(saveButton)
    expect(updateInstitutionPrintingSettings).toHaveBeenCalledTimes(1)

    resolveSave?.({ ok: false, error_code: 'SECRETARY_NOT_AUTHORIZED' })
    expect(await screen.findByRole('alert')).toHaveTextContent(/מזכירה/)
    expect(screen.getByRole('radio', { name: '3 שעות מראש' })).toBeChecked()
  })
})
