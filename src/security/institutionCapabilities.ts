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

/** D3C: edit existing operational users. D3B: Manager only. Secretary uses her own dashboard. */
export function canEditOperationalUser(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager'
}

/** Invite or administer Deputies. Manager only. */
export function canManageDeputies(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager'
}

export function canUsePersonalGoogleIntegration(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager' || role === 'secretary' || role === 'deputy'
}
