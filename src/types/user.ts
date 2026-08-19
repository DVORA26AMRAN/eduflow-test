import type { School } from './school'

/**
 * Roles a tenant inviter may submit on the shared CreateUserForm / clever-processor
 * tenant branch. Distinct from PrimaryRole (authenticated identity).
 * Caller-specific allow-lists still decide who may invite which of these.
 */
export type TenantInviteRole = 'teacher' | 'secretary' | 'deputy'

/** Invite-form role. Not PrimaryRole. */
export type UserRole = TenantInviteRole

export type PrimaryRole =
  | 'institution_manager'
  | 'deputy'
  | 'secretary'
  | 'teacher'
  | 'platform_admin'

export type InstitutionUser = {
  id: string
  full_name: string
  email: string
  primary_role: PrimaryRole
  status: string
}

/** Optional employee fields on public.users (Phase 3A.1 teacher extended profile). */
export type TeacherExtendedProfileFields = {
  phone: string | null
  nationalId: string | null
  jobTitle: string | null
  weeklyHours: number | null
}

export type UserAccountStatus = 'active' | 'inactive'

export type AuthenticatedUserProfile = {
  id: string
  fullName: string
  role: PrimaryRole
  status: UserAccountStatus
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
