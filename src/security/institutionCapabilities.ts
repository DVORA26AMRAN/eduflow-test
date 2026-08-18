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

/** D3 user management. D2: Manager only; Deputy is hard-denied. */
export function canManageTeamUsers(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager'
}

export function canUsePersonalGoogleIntegration(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager' || role === 'secretary' || role === 'deputy'
}
