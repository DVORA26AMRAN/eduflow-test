import { afterEach, describe, expect, it, vi } from 'vitest'
import { triggerAttachmentDownload } from './attachmentDownload'

describe('triggerAttachmentDownload', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('downloads using the signed URL and original filename', async () => {
    const click = vi.fn()
    const remove = vi.fn()
    const revokeObjectURL = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:mock-url')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(['file'], { type: 'application/pdf' }),
      })),
    )

    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })

    const link = {
      href: '',
      download: '',
      rel: '',
      click,
      remove,
    }

    vi.spyOn(document, 'createElement').mockReturnValue(link as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => link as unknown as Node)

    const result = await triggerAttachmentDownload('https://signed.example/file', 'report.pdf')

    expect(result).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith('https://signed.example/file')
    expect(createObjectURL).toHaveBeenCalled()
    expect(link.download).toBe('report.pdf')
    expect(click).toHaveBeenCalled()
    expect(remove).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('returns an error when download fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
      })),
    )

    const result = await triggerAttachmentDownload('https://signed.example/file', 'report.pdf')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toBe('טעינת הקובץ נכשלה.')
    }
  })
})
