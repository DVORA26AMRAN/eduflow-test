import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestDetailsAttachmentsSection } from './RequestDetailsAttachmentsSection'

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

describe('RequestDetailsAttachmentsSection', () => {
  it('renders file metadata and preview/download actions', async () => {
    render(
      <RequestDetailsAttachmentsSection
        requestId="req-1"
        isActive
        knownHasAttachment
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument()
    })

    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'צפייה בקובץ' })).toHaveTextContent('צפייה')
    expect(screen.getByRole('button', { name: 'הורדת הקובץ' })).toHaveTextContent('הורדה')
    expect(document.querySelector('.request-attachment__icon svg')).not.toBeNull()
  })

  it('opens preview in a new tab using the signed URL', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    vi.stubGlobal('open', open)

    render(
      <RequestDetailsAttachmentsSection
        requestId="req-1"
        isActive
        knownHasAttachment
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'צפייה בקובץ' })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: 'צפייה בקובץ' }))

    await waitFor(() => {
      expect(createAttachmentSignedUrl).toHaveBeenCalledWith(attachment.storage_path)
      expect(open).toHaveBeenCalledWith(
        'https://signed.example/report.pdf',
        '_blank',
        'noopener,noreferrer',
      )
    })
  })

  it('downloads the attachment with the original filename', async () => {
    const user = userEvent.setup()
    const click = vi.fn()
    const remove = vi.fn()
    const originalCreateElement = document.createElement.bind(document)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(['file'], { type: 'application/pdf' }),
      })),
    )

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') {
        const anchor = originalCreateElement('a') as HTMLAnchorElement
        anchor.click = click
        anchor.remove = remove
        return anchor
      }

      return originalCreateElement(tagName)
    })

    render(
      <RequestDetailsAttachmentsSection
        requestId="req-1"
        isActive
        knownHasAttachment
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'הורדת הקובץ' })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: 'הורדת הקובץ' }))

    await waitFor(() => {
      expect(createAttachmentSignedUrl).toHaveBeenCalledWith(attachment.storage_path)
      expect(click).toHaveBeenCalled()
    })
  })

  it('shows action errors without duplicating storage logic', async () => {
    const user = userEvent.setup()
    createAttachmentSignedUrl.mockResolvedValueOnce({
      ok: false,
      errorMessage: 'טעינת הקובץ נכשלה.',
    })

    render(
      <RequestDetailsAttachmentsSection
        requestId="req-1"
        isActive
        knownHasAttachment
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'הורדת הקובץ' })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: 'הורדת הקובץ' }))

    expect(await screen.findByText('טעינת הקובץ נכשלה.')).toBeInTheDocument()
  })
})
