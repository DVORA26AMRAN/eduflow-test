export function formatAttachmentFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return ''
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isPreviewableAttachmentType(fileType: string): boolean {
  return (
    fileType === 'application/pdf' ||
    fileType === 'image/png' ||
    fileType === 'image/jpeg' ||
    fileType.startsWith('text/')
  )
}
