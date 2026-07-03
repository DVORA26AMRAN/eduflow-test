export type RequestAttachmentMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'application/pdf'

export const REQUEST_ATTACHMENTS_BUCKET = 'request-attachments'

export const MAX_REQUEST_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024

export const ALLOWED_REQUEST_ATTACHMENT_MIME_TYPES: readonly RequestAttachmentMimeType[] = [
  'image/png',
  'image/jpeg',
  'application/pdf',
]

export const REQUEST_ATTACHMENT_ACCEPT =
  'image/png,image/jpeg,application/pdf'

export const UNSUPPORTED_ATTACHMENT_TYPE_MESSAGE = 'סוג הקובץ אינו נתמך.'

export const ATTACHMENT_TOO_LARGE_MESSAGE = 'גודל הקובץ חייב להיות עד 5MB.'

export const REQUEST_CREATED_ATTACHMENT_UPLOAD_FAILED_MESSAGE =
  'הבקשה נוצרה אך העלאת הקובץ נכשלה.'

export const ATTACHMENT_LOADING_MESSAGE = 'טוען קובץ...'

export const ATTACHMENT_LOAD_ERROR_MESSAGE = 'טעינת הקובץ נכשלה.'

export const NO_ATTACHMENT_MESSAGE = 'אין קובץ'

export const VIEW_ATTACHMENT_BUTTON_LABEL = 'צפייה בקובץ'

export type RequestAttachment = {
  id: string
  request_id: string
  storage_path: string
  file_name: string
  file_type: string
  file_size_bytes: number
  created_at: string
}
