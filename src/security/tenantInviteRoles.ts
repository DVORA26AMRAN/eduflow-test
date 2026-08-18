import type { PrimaryRole, TenantInviteRole } from '../types/user'

/** Manager tenant invite allow-list (D3A). Not PrimaryRole. */
export const MANAGER_TENANT_INVITE_ROLES: readonly TenantInviteRole[] = [
  'teacher',
  'secretary',
  'deputy',
]

/** Secretary tenant invite allow-list. Unchanged: teacher only. */
export const SECRETARY_TENANT_INVITE_ROLES: readonly TenantInviteRole[] = ['teacher']

/**
 * Caller-specific invite allow-list. Empty means the caller cannot invite anyone.
 * D3A: Deputy is denied. Platform Admin uses a separate manager-invite branch.
 */
export function getAllowedTenantInviteRoles(
  callerRole: PrimaryRole | null | undefined,
): readonly TenantInviteRole[] {
  if (callerRole === 'institution_manager') {
    return MANAGER_TENANT_INVITE_ROLES
  }

  if (callerRole === 'secretary') {
    return SECRETARY_TENANT_INVITE_ROLES
  }

  return []
}

export function canCallerInviteRole(
  callerRole: PrimaryRole | null | undefined,
  requestedRole: TenantInviteRole,
): boolean {
  return getAllowedTenantInviteRoles(callerRole).includes(requestedRole)
}
