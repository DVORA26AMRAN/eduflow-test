import { describe, expect, it } from 'vitest'
import { formatAttachmentFileSize, isPreviewableAttachmentType } from './attachmentDisplay'

describe('formatAttachmentFileSize', () => {
  it('formats bytes, kilobytes, and megabytes', () => {
    expect(formatAttachmentFileSize(512)).toBe('512 B')
    expect(formatAttachmentFileSize(2048)).toBe('2.0 KB')
    expect(formatAttachmentFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('isPreviewableAttachmentType', () => {
  it('supports browser-previewable attachment types', () => {
    expect(isPreviewableAttachmentType('application/pdf')).toBe(true)
    expect(isPreviewableAttachmentType('image/png')).toBe(true)
    expect(isPreviewableAttachmentType('image/jpeg')).toBe(true)
    expect(isPreviewableAttachmentType('text/plain')).toBe(true)
    expect(isPreviewableAttachmentType('application/zip')).toBe(false)
  })
})
