import type { InstitutionSummary } from '../types/school'
import {
  INSTITUTION_LOGOS_BUCKET,
  INSTITUTION_LOGO_REMOVE_ERROR_MESSAGE,
  INSTITUTION_LOGO_UPLOAD_ERROR_MESSAGE,
  type InstitutionLogoMimeType,
} from '../types/institutionLogo'
import {
  extensionForInstitutionLogoMimeType,
  extractInstitutionLogoStoragePath,
  validateInstitutionLogoFile,
} from '../utils/institutionLogo'
import { supabase, supabaseUrl } from './supabase'

export type LoadInstitutionsResult =
  | { ok: true; institutions: InstitutionSummary[] }
  | { ok: false; errorMessage: string }

export type UploadInstitutionLogoResult =
  | { ok: true; logoUrl: string }
  | { ok: false; errorMessage: string }

export type RemoveInstitutionLogoResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

function mapInstitutionRow(row: {
  id: unknown
  name: unknown
  logo_url: unknown
  logo_updated_at: unknown
}): InstitutionSummary | null {
  if (typeof row.id !== 'string' || typeof row.name !== 'string') {
    return null
  }

  return {
    id: row.id,
    name: row.name,
    logoUrl: typeof row.logo_url === 'string' ? row.logo_url : null,
    logoUpdatedAt:
      typeof row.logo_updated_at === 'string' ? row.logo_updated_at : null,
  }
}

function buildPublicInstitutionLogoUrl(storagePath: string): string {
  const encodedPath = storagePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `${supabaseUrl}/storage/v1/object/public/${INSTITUTION_LOGOS_BUCKET}/${encodedPath}`
}

export async function loadAllInstitutions(): Promise<LoadInstitutionsResult> {
  const { data, error } = await supabase
    .from('institutions')
    .select('id, name, logo_url, logo_updated_at')
    .order('name', { ascending: true })

  if (error) {
    console.error('[institutionLogo] failed to load institutions', error)
    return {
      ok: false,
      errorMessage: 'לא ניתן לטעון את רשימת בתי הספר.',
    }
  }

  const institutions = (data ?? [])
    .map(mapInstitutionRow)
    .filter((institution): institution is InstitutionSummary => institution !== null)

  return { ok: true, institutions }
}

export async function uploadInstitutionLogo(input: {
  institutionId: string
  file: File
}): Promise<UploadInstitutionLogoResult> {
  const validation = validateInstitutionLogoFile(input.file)
  if (!validation.ok) {
    return validation
  }

  const { data: currentInstitution, error: currentError } = await supabase
    .from('institutions')
    .select('logo_url')
    .eq('id', input.institutionId)
    .maybeSingle()

  if (currentError) {
    console.error('[institutionLogo] failed to load current logo', currentError)
    return {
      ok: false,
      errorMessage: INSTITUTION_LOGO_UPLOAD_ERROR_MESSAGE,
    }
  }

  const extension = extensionForInstitutionLogoMimeType(input.file.type as InstitutionLogoMimeType)
  const storagePath = `${input.institutionId}/${crypto.randomUUID()}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from(INSTITUTION_LOGOS_BUCKET)
    .upload(storagePath, input.file, {
      contentType: input.file.type,
      upsert: false,
    })

  if (uploadError) {
    console.error('[institutionLogo] storage upload failed', uploadError)
    return {
      ok: false,
      errorMessage: INSTITUTION_LOGO_UPLOAD_ERROR_MESSAGE,
    }
  }

  const logoUrl = buildPublicInstitutionLogoUrl(storagePath)
  const logoUpdatedAt = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('institutions')
    .update({
      logo_url: logoUrl,
      logo_updated_at: logoUpdatedAt,
    })
    .eq('id', input.institutionId)

  if (updateError) {
    console.error('[institutionLogo] institution update failed', updateError)
    await supabase.storage.from(INSTITUTION_LOGOS_BUCKET).remove([storagePath])
    return {
      ok: false,
      errorMessage: INSTITUTION_LOGO_UPLOAD_ERROR_MESSAGE,
    }
  }

  const previousStoragePath = extractInstitutionLogoStoragePath(
    typeof currentInstitution?.logo_url === 'string' ? currentInstitution.logo_url : null,
  )

  if (previousStoragePath) {
    const { error: removeError } = await supabase.storage
      .from(INSTITUTION_LOGOS_BUCKET)
      .remove([previousStoragePath])

    if (removeError) {
      console.error('[institutionLogo] failed to remove previous logo file', removeError)
    }
  }

  return { ok: true, logoUrl }
}

export async function removeInstitutionLogo(
  institutionId: string,
): Promise<RemoveInstitutionLogoResult> {
  const { data: currentInstitution, error: currentError } = await supabase
    .from('institutions')
    .select('logo_url')
    .eq('id', institutionId)
    .maybeSingle()

  if (currentError) {
    console.error('[institutionLogo] failed to load institution for removal', currentError)
    return {
      ok: false,
      errorMessage: INSTITUTION_LOGO_REMOVE_ERROR_MESSAGE,
    }
  }

  const currentLogoUrl =
    typeof currentInstitution?.logo_url === 'string' ? currentInstitution.logo_url : null

  const { error: updateError } = await supabase
    .from('institutions')
    .update({
      logo_url: null,
      logo_updated_at: new Date().toISOString(),
    })
    .eq('id', institutionId)

  if (updateError) {
    console.error('[institutionLogo] failed to clear institution logo', updateError)
    return {
      ok: false,
      errorMessage: INSTITUTION_LOGO_REMOVE_ERROR_MESSAGE,
    }
  }

  const storagePath = extractInstitutionLogoStoragePath(currentLogoUrl)
  if (storagePath) {
    const { error: removeError } = await supabase.storage
      .from(INSTITUTION_LOGOS_BUCKET)
      .remove([storagePath])

    if (removeError) {
      console.error('[institutionLogo] failed to remove logo file', removeError)
    }
  }

  return { ok: true }
}
