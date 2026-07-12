import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecretaryRequestAttachmentCell } from './SecretaryRequestAttachmentCell'

const loadRequestAttachments = vi.fn()
const createAttachmentSignedUrl = vi.fn()

vi.mock('../../services/attachments', () => ({
  loadRequestAttachments: (...args: unknown[]) => loadRequestAttachments(...args),
  createAttachmentSignedUrl: (...args: unknown[]) => createAttachmentSignedUrl(...args),
}))

const attachment = {
  id: 'att-1',
  request_id: 'req-1',
  storage_path: 'institution/req-1/att-1/report.pdf',
  file_name: 'report.pdf',
  file_type: 'application/pdf',
  file_size_bytes: 2048,
  created_at: '2026-07-01T10:00:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  loadRequestAttachments.mockResolvedValue({ ok: true, attachments: [attachment] })
  createAttachmentSignedUrl.mockResolvedValue({
    ok: true,
    signedUrl: 'https://signed.example/report.pdf',
  })
})

describe('SecretaryRequestAttachmentCell', () => {
  it('shows preview and download actions for requests with attachments', async () => {
    render(<SecretaryRequestAttachmentCell requestId="req-1" hasAttachment />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'צפייה בקובץ' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'הורדת הקובץ' })).toBeInTheDocument()
    })
  })

  it('supports keyboard focus on attachment actions', async () => {
    render(<SecretaryRequestAttachmentCell requestId="req-1" hasAttachment />)

    const previewButton = await screen.findByRole('button', { name: 'צפייה בקובץ' })
    previewButton.focus()

    expect(previewButton).toHaveFocus()
  })

  it('shows empty state when no attachment exists', () => {
    render(<SecretaryRequestAttachmentCell requestId="req-1" hasAttachment={false} />)

    expect(screen.getByText('אין קובץ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'צפייה בקובץ' })).not.toBeInTheDocument()
  })
})
