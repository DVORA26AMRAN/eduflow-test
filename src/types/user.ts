export type UserRole = 'teacher' | 'secretary'

export type PrimaryRole = 'institution_manager' | 'secretary' | 'teacher'

export type InstitutionUser = {
  full_name: string
  email: string
  primary_role: PrimaryRole
}

export type ProfileLoadDebugInfo = {
  sessionUserId: string | null
  sessionEmail: string | null
  queryUserId: string | null
  errorMessage: string | null
  errorCode: string | null
  dataWasNull: boolean
}

export type ProfileLoadResult =
  | { ok: true; role: PrimaryRole }
  | { ok: false; debug: ProfileLoadDebugInfo }
