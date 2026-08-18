import { describe, expect, it } from 'vitest'
import type { PrimaryRole } from '../types/user'
import {
  canCreateOperationalUser,
  canEditOperationalUser,
  canEditStaffNationalId,
  canManageCalendar,
  canManageDeputies,
  canManageInstitutionSettings,
  canManageRequests,
  canManageTeamUsers,
  canUseOperationalPrinting,
  canUsePersonalGoogleIntegration,
  canViewInstitutionArchive,
  canViewTeamManagement,
  isInstitutionOperatorRole,
} from './institutionCapabilities'

const ALL_ROLES: PrimaryRole[] = [
  'institution_manager',
  'deputy',
  'secretary',
  'teacher',
  'platform_admin',
]

describe('D2 institution capability helpers', () => {
  it('treats only Manager and Deputy as institution operators', () => {
    expect(isInstitutionOperatorRole('institution_manager')).toBe(true)
    expect(isInstitutionOperatorRole('deputy')).toBe(true)
    expect(isInstitutionOperatorRole('secretary')).toBe(false)
    expect(isInstitutionOperatorRole('teacher')).toBe(false)
    expect(isInstitutionOperatorRole('platform_admin')).toBe(false)
    expect(isInstitutionOperatorRole(null)).toBe(false)
  })

  it('grants Deputy operational capabilities and denies institution settings and full user administration', () => {
    expect(canManageRequests('deputy')).toBe(true)
    expect(canManageCalendar('deputy')).toBe(true)
    expect(canUseOperationalPrinting('deputy')).toBe(true)
    expect(canViewInstitutionArchive('deputy')).toBe(true)
    expect(canUsePersonalGoogleIntegration('deputy')).toBe(true)
    expect(canManageInstitutionSettings('deputy')).toBe(false)
    expect(canManageTeamUsers('deputy')).toBe(false)
    expect(canViewTeamManagement('deputy')).toBe(true)
    expect(canCreateOperationalUser('deputy')).toBe(true)
    expect(canEditOperationalUser('deputy')).toBe(false)
    expect(canEditOperationalUser('deputy', 'teacher')).toBe(true)
    expect(canEditOperationalUser('deputy', 'secretary')).toBe(true)
    expect(canEditOperationalUser('deputy', 'institution_manager')).toBe(false)
    expect(canEditOperationalUser('deputy', 'deputy')).toBe(false)
    expect(canEditStaffNationalId('deputy')).toBe(false)
    expect(canManageDeputies('deputy')).toBe(false)
  })

  it('keeps Manager capabilities complete', () => {
    expect(canManageRequests('institution_manager')).toBe(true)
    expect(canManageCalendar('institution_manager')).toBe(true)
    expect(canUseOperationalPrinting('institution_manager')).toBe(true)
    expect(canViewInstitutionArchive('institution_manager')).toBe(true)
    expect(canManageInstitutionSettings('institution_manager')).toBe(true)
    expect(canManageTeamUsers('institution_manager')).toBe(true)
    expect(canViewTeamManagement('institution_manager')).toBe(true)
    expect(canCreateOperationalUser('institution_manager')).toBe(true)
    expect(canEditOperationalUser('institution_manager')).toBe(true)
    expect(canEditOperationalUser('institution_manager', 'teacher')).toBe(true)
    expect(canEditOperationalUser('institution_manager', 'secretary')).toBe(false)
    expect(canEditOperationalUser('secretary', 'teacher')).toBe(true)
    expect(canEditOperationalUser('secretary', 'secretary')).toBe(false)
    expect(canEditStaffNationalId('institution_manager')).toBe(true)
    expect(canEditStaffNationalId('secretary')).toBe(true)
    expect(canManageDeputies('institution_manager')).toBe(true)
    expect(canUsePersonalGoogleIntegration('institution_manager')).toBe(true)
  })

  it('does not grant operator dashboard capabilities to Secretary, Teacher, or Platform Admin', () => {
    for (const role of ALL_ROLES.filter(
      (candidate) => candidate !== 'institution_manager' && candidate !== 'deputy',
    )) {
      expect(canManageRequests(role)).toBe(false)
      expect(canManageCalendar(role)).toBe(false)
      expect(canUseOperationalPrinting(role)).toBe(false)
      expect(canViewInstitutionArchive(role)).toBe(false)
      expect(canManageInstitutionSettings(role)).toBe(false)
      expect(canManageTeamUsers(role)).toBe(false)
      expect(canViewTeamManagement(role)).toBe(false)
      expect(canCreateOperationalUser(role)).toBe(false)
      expect(canEditOperationalUser(role)).toBe(false)
      expect(canManageDeputies(role)).toBe(false)
    }

    expect(canUsePersonalGoogleIntegration('secretary')).toBe(true)
    expect(canUsePersonalGoogleIntegration('teacher')).toBe(false)
    expect(canUsePersonalGoogleIntegration('platform_admin')).toBe(false)
  })
})
