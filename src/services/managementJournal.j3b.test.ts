import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, fetchMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}))

import { downloadManagementJournalDailySummaryPdf } from './managementJournal'

describe('downloadManagementJournalDailySummaryPdf', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:pdf'),
      revokeObjectURL: vi.fn(),
    })
    document.body.innerHTML = ''
  })

  it('posts only page_id and downloads application/pdf bytes', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'tok' } },
      error: null,
    })
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
    fetchMock.mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="management-journal-2026-08-20.pdf"',
        },
      }),
    )

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const result = await downloadManagementJournalDailySummaryPdf('11111111-1111-4111-8111-111111111111')

    expect(result).toEqual({ ok: true, filename: 'management-journal-2026-08-20.pdf' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/management-journal-daily-summary-pdf',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ page_id: '11111111-1111-4111-8111-111111111111' }),
      }),
    )
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(sent).toEqual({ page_id: '11111111-1111-4111-8111-111111111111' })
    expect(sent).not.toHaveProperty('tasks')
    expect(clickSpy).toHaveBeenCalled()
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf')
    clickSpy.mockRestore()
  })

  it('maps unauthorized responses to a Hebrew permission error', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'tok' } },
      error: null,
    })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await downloadManagementJournalDailySummaryPdf('11111111-1111-4111-8111-111111111111')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/הרשאה/)
      expect(result.errorCode).toBe('unauthorized')
    }
  })

  it('maps forbidden responses to a Hebrew permission error', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'tok' } },
      error: null,
    })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await downloadManagementJournalDailySummaryPdf('11111111-1111-4111-8111-111111111111')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/הרשאה/)
      expect(result.errorCode).toBe('forbidden')
    }
  })

  it('maps pdf_* generation failures to the dedicated PDF error', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'tok' } },
      error: null,
    })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'pdf_font_hash_mismatch' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await downloadManagementJournalDailySummaryPdf('11111111-1111-4111-8111-111111111111')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/PDF/)
      expect(result.errorCode).toBe('pdf_font_hash_mismatch')
    }
  })
})
