import { describe, expect, it } from 'vitest'
import type { PrimaryRole, TenantInviteRole } from '../types/user'
import {
  canCallerInviteRole,
  getAllowedTenantInviteRoles,
  MANAGER_TENANT_INVITE_ROLES,
  SECRETARY_TENANT_INVITE_ROLES,
} from './tenantInviteRoles'

const ALL_PRIMARY_ROLES: PrimaryRole[] = [
  'institution_manager',
  'deputy',
  'secretary',
  'teacher',
  'platform_admin',
]

const ALL_INVITE_ROLES: TenantInviteRole[] = ['teacher', 'secretary', 'deputy']

describe('D3A tenant invite role matrix', () => {
  it('lets Manager invite teacher, secretary, and deputy only', () => {
    expect(getAllowedTenantInviteRoles('institution_manager')).toEqual([
      'teacher',
      'secretary',
      'deputy',
    ])
    expect(canCallerInviteRole('institution_manager', 'teacher')).toBe(true)
    expect(canCallerInviteRole('institution_manager', 'secretary')).toBe(true)
    expect(canCallerInviteRole('institution_manager', 'deputy')).toBe(true)
    expect(MANAGER_TENANT_INVITE_ROLES).not.toContain('institution_manager')
    expect(MANAGER_TENANT_INVITE_ROLES).not.toContain('platform_admin')
  })

  it('lets Secretary invite teacher only', () => {
    expect(getAllowedTenantInviteRoles('secretary')).toEqual(['teacher'])
    expect(canCallerInviteRole('secretary', 'teacher')).toBe(true)
    expect(canCallerInviteRole('secretary', 'secretary')).toBe(false)
    expect(canCallerInviteRole('secretary', 'deputy')).toBe(false)
    expect(SECRETARY_TENANT_INVITE_ROLES).toEqual(['teacher'])
  })

  it('denies Deputy inviting any tenant role', () => {
    expect(getAllowedTenantInviteRoles('deputy')).toEqual([])
    for (const role of ALL_INVITE_ROLES) {
      expect(canCallerInviteRole('deputy', role)).toBe(false)
    }
  })

  it('denies Teacher and Platform Admin on the tenant invite matrix', () => {
    expect(getAllowedTenantInviteRoles('teacher')).toEqual([])
    expect(getAllowedTenantInviteRoles('platform_admin')).toEqual([])
    expect(getAllowedTenantInviteRoles(null)).toEqual([])

    for (const caller of ALL_PRIMARY_ROLES.filter(
      (role) => role !== 'institution_manager' && role !== 'secretary',
    )) {
      for (const requested of ALL_INVITE_ROLES) {
        expect(canCallerInviteRole(caller, requested)).toBe(false)
      }
    }
  })
})
