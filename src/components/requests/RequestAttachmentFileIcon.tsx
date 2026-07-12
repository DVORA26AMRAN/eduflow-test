type RequestAttachmentFileIconProps = {
  fileType: string
}

function iconStroke() {
  return {
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  }
}

function ImageFileIcon() {
  const stroke = iconStroke()

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.5" y="5.5" width="15" height="13" rx="2" {...stroke} />
      <circle cx="9" cy="10" r="1.4" {...stroke} />
      <path d="m6.5 16.5 3.5-3.5 2.2 2.2L14.5 11l3 4.5" {...stroke} />
    </svg>
  )
}

function PdfFileIcon() {
  const stroke = iconStroke()

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5h7.2L18.5 9v10.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" {...stroke} />
      <path d="M14 4.5V9h4.5" {...stroke} />
      <path d="M8.5 12.5h7M8.5 15.5h5" {...stroke} />
    </svg>
  )
}

function GenericFileIcon() {
  const stroke = iconStroke()

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5h7.2L18.5 9v10.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" {...stroke} />
      <path d="M14 4.5V9h4.5" {...stroke} />
    </svg>
  )
}

export function RequestAttachmentFileIcon({ fileType }: RequestAttachmentFileIconProps) {
  const isImage = fileType === 'image/png' || fileType === 'image/jpeg'
  const isPdf = fileType === 'application/pdf'

  return (
    <span className="request-attachment__icon" aria-hidden="true">
      {isImage ? <ImageFileIcon /> : isPdf ? <PdfFileIcon /> : <GenericFileIcon />}
    </span>
  )
}
