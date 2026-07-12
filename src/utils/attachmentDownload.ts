import { ATTACHMENT_LOAD_ERROR_MESSAGE } from '../types/attachment'

export async function triggerAttachmentDownload(
  signedUrl: string,
  fileName: string,
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  try {
    const response = await fetch(signedUrl)

    if (!response.ok) {
      return {
        ok: false,
        errorMessage: ATTACHMENT_LOAD_ERROR_MESSAGE,
      }
    }

    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)

    return { ok: true }
  } catch (error) {
    console.error('[attachments] download failed', error)
    return {
      ok: false,
      errorMessage: ATTACHMENT_LOAD_ERROR_MESSAGE,
    }
  }
}
