import type { PrimaryRole } from '../types/user'

/**
 * D2 frontend capability boundaries for the shared Manager dashboard.
 * Backend/RLS remains authoritative. These helpers must not be treated as a
 * generic permissions framework.
 */
export function isInstitutionOperatorRole(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager' || role === 'deputy'
}

export function canManageRequests(role: PrimaryRole | null | undefined): boolean {
  return isInstitutionOperatorRole(role)
}

export function canManageCalendar(role: PrimaryRole | null | undefined): boolean {
  return isInstitutionOperatorRole(role)
}

export function canUseOperationalPrinting(role: PrimaryRole | null | undefined): boolean {
  return isInstitutionOperatorRole(role)
}

export function canViewInstitutionArchive(role: PrimaryRole | null | undefined): boolean {
  return isInstitutionOperatorRole(role)
}

export function canManageInstitutionSettings(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager'
}

/**
 * Full team administration (edit, deputy invite, privileged actions).
 * Manager only. Do not treat this as "can see Team Management".
 */
export function canManageTeamUsers(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager'
}

/** D3B: Manager and Deputy may open the shared Team Management surface. */
export function canViewTeamManagement(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager' || role === 'deputy'
}

/** D3B: Manager and Deputy may create operational users (role matrix still applies). */
export function canCreateOperationalUser(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager' || role === 'deputy'
}

/** D3C: target-role-aware operational edit. Secretary remains teacher-only. */
export function canEditOperationalUser(
  actorRole: PrimaryRole | null | undefined,
  targetRole?: PrimaryRole | null,
): boolean {
  if (actorRole === 'institution_manager') {
    if (targetRole == null) {
      return true
    }
    return targetRole === 'teacher'
  }

  if (actorRole === 'secretary') {
    return targetRole === 'teacher'
  }

  if (actorRole === 'deputy') {
    return targetRole === 'teacher' || targetRole === 'secretary'
  }

  return false
}

export function canEditStaffNationalId(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager' || role === 'secretary'
}

/** Invite or administer Deputies. Manager only. */
export function canManageDeputies(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager'
}

/**
 * S4: Manager may reactivate inactive teacher, secretary, or deputy targets.
 * Same authorization matrix as canDeactivateStaff. Backend remains authoritative.
 */
export function canReactivateStaff(
  actorRole: PrimaryRole | null | undefined,
  targetRole: PrimaryRole | null | undefined,
  actorUserId: string | null | undefined,
  targetUserId: string | null | undefined,
): boolean {
  if (actorRole !== 'institution_manager') {
    return false
  }
  if (!actorUserId || !targetUserId || actorUserId === targetUserId) {
    return false
  }
  return (
    targetRole === 'teacher' || targetRole === 'secretary' || targetRole === 'deputy'
  )
}

/**
 * S3: Manager may deactivate teacher, secretary, or deputy targets.
 * Never self, never Manager, never Platform Admin. Backend remains authoritative.
 */
export function canDeactivateStaff(
  actorRole: PrimaryRole | null | undefined,
  targetRole: PrimaryRole | null | undefined,
  actorUserId: string | null | undefined,
  targetUserId: string | null | undefined,
): boolean {
  if (actorRole !== 'institution_manager') {
    return false
  }
  if (!actorUserId || !targetUserId || actorUserId === targetUserId) {
    return false
  }
  return (
    targetRole === 'teacher' || targetRole === 'secretary' || targetRole === 'deputy'
  )
}

export function canUsePersonalGoogleIntegration(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager' || role === 'secretary' || role === 'deputy'
}
