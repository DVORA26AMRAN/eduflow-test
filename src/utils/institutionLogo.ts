import {
  ALLOWED_INSTITUTION_LOGO_MIME_TYPES,
  INSTITUTION_LOGO_TOO_LARGE_MESSAGE,
  INSTITUTION_LOGO_UNSUPPORTED_TYPE_MESSAGE,
  type InstitutionLogoMimeType,
  MAX_INSTITUTION_LOGO_SIZE_BYTES,
} from '../types/institutionLogo'

export type ValidateInstitutionLogoResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export function isAllowedInstitutionLogoMimeType(
  mimeType: string,
): mimeType is InstitutionLogoMimeType {
  return (ALLOWED_INSTITUTION_LOGO_MIME_TYPES as readonly string[]).includes(mimeType)
}

export function validateInstitutionLogoFile(file: File): ValidateInstitutionLogoResult {
  if (!isAllowedInstitutionLogoMimeType(file.type)) {
    return {
      ok: false,
      errorMessage: INSTITUTION_LOGO_UNSUPPORTED_TYPE_MESSAGE,
    }
  }

  if (file.size <= 0 || file.size > MAX_INSTITUTION_LOGO_SIZE_BYTES) {
    return {
      ok: false,
      errorMessage: INSTITUTION_LOGO_TOO_LARGE_MESSAGE,
    }
  }

  return { ok: true }
}

export function extensionForInstitutionLogoMimeType(mimeType: InstitutionLogoMimeType): string {
  switch (mimeType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
  }
}

export function extractInstitutionLogoStoragePath(logoUrl: string | null): string | null {
  if (!logoUrl) {
    return null
  }

  const marker = '/storage/v1/object/public/institution-logos/'
  const markerIndex = logoUrl.indexOf(marker)
  if (markerIndex === -1) {
    return null
  }

  return decodeURIComponent(logoUrl.slice(markerIndex + marker.length))
}
