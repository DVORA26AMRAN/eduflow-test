import type { School } from './school'

export type UserRole = 'teacher' | 'secretary'

export type PrimaryRole = 'institution_manager' | 'secretary' | 'teacher' | 'platform_admin'

export type InstitutionUser = {
  full_name: string
  email: string
  primary_role: PrimaryRole
}

/** Optional employee fields on public.users (Phase 3A.1 teacher extended profile). */
export type TeacherExtendedProfileFields = {
  phone: string | null
  nationalId: string | null
  jobTitle: string | null
  weeklyHours: number | null
}

export type AuthenticatedUserProfile = {
  id: string
  fullName: string
  role: PrimaryRole
  school: School | null
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
  | { ok: true; profile: AuthenticatedUserProfile }
  | { ok: false; debug: ProfileLoadDebugInfo }
