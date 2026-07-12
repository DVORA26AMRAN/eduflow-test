export const INSTITUTION_LOGOS_BUCKET = 'institution-logos'

export const ALLOWED_INSTITUTION_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export type InstitutionLogoMimeType = (typeof ALLOWED_INSTITUTION_LOGO_MIME_TYPES)[number]

export const MAX_INSTITUTION_LOGO_SIZE_BYTES = 2 * 1024 * 1024

export const INSTITUTION_LOGO_UNSUPPORTED_TYPE_MESSAGE =
  'ניתן להעלות רק קבצי PNG, JPEG או WebP.'

export const INSTITUTION_LOGO_TOO_LARGE_MESSAGE = 'גודל קובץ הלוגו חורג מהמגבלה המותרת.'

export const INSTITUTION_LOGO_UPLOAD_ERROR_MESSAGE = 'העלאת הלוגו נכשלה.'

export const INSTITUTION_LOGO_REMOVE_ERROR_MESSAGE = 'הסרת הלוגו נכשלה.'

export const SCHOOL_LOGO_PLACEHOLDER_TEXT = 'הלוגו של בית הספר שלך יכול להיות כאן'
