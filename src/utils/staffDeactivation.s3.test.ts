/**
 * S3 Frontend contract tests for Staff Deactivation.
 * Requirement references match the S3 task specification.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canDeactivateStaff } from '../security/institutionCapabilities'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const APP = 'src/App.tsx'
const TEAM = 'src/components/manager/TeamManagementSection.tsx'
const STAFF_MODAL = 'src/components/staff/StaffMemberDetailsModal.tsx'
const DEACTIVATE_MODAL = 'src/components/staff/StaffDeactivationConfirmModal.tsx'
const SERVICE = 'src/services/staffDirectory.ts'
const CAPABILITIES = 'src/security/institutionCapabilities.ts'
const INSTITUTION_USERS = 'src/services/institutionUsers.ts'
const PROFILE_SERVICE = 'src/services/profile.ts'

// S3 req 1: SERVICE LAYER
describe('S3 service layer', () => {
  it('service calls rpc deactivate_staff_member and does not use direct users UPDATE', () => {
    const service = read(SERVICE)
    expect(service).toContain("rpc('deactivate_staff_member'")
    expect(service).toContain("p_user_id: userId")
    // Must not scatter RPC calls or do direct update
    expect(service).not.toContain(".from('users').update")
  })

  it('RPC call is not scattered in components or pages', () => {
    const team = read(TEAM)
    const modal = read(STAFF_MODAL)
    const app = read(APP)
    expect(team).not.toContain("rpc('deactivate_staff_member'")
    expect(modal).not.toContain("rpc('deactivate_staff_member'")
    expect(app).not.toContain("rpc('deactivate_staff_member'")
  })

  it('service maps permission errors to stable Hebrew messages', () => {
    const service = read(SERVICE)
    expect(service).toContain('permission denied')
    expect(service).toContain('42501')
    expect(service).toContain('אין הרשאה לבצע השבתה זו')
  })

  it('no direct users UPDATE anywhere in frontend', () => {
    const filesToCheck = [APP, TEAM, STAFF_MODAL, SERVICE, INSTITUTION_USERS]
    for (const path of filesToCheck) {
      const src = read(path)
      expect(src).not.toMatch(/\.from\(['"]users['"]\)\s*\.update/i)
    }
  })
})

// S3 req 2: MANAGER-ONLY UI — canDeactivateStaff logic
describe('S3 canDeactivateStaff security helper (req 2)', () => {
  const managerId = 'manager-1'
  const targetId = 'other-1'

  it('Manager sees deactivation for Teacher', () => {
    expect(canDeactivateStaff('institution_manager', 'teacher', managerId, targetId)).toBe(true)
  })

  it('Manager sees deactivation for Secretary', () => {
    expect(canDeactivateStaff('institution_manager', 'secretary', managerId, targetId)).toBe(true)
  })

  it('Manager sees deactivation for Deputy', () => {
    expect(canDeactivateStaff('institution_manager', 'deputy', managerId, targetId)).toBe(true)
  })

  it('Manager does not see deactivation for self', () => {
    expect(canDeactivateStaff('institution_manager', 'institution_manager', managerId, managerId)).toBe(false)
  })

  it('Manager does not see deactivation for another Manager target', () => {
    expect(canDeactivateStaff('institution_manager', 'institution_manager', managerId, targetId)).toBe(false)
  })

  it('Manager does not see deactivation for Platform Admin target', () => {
    expect(canDeactivateStaff('institution_manager', 'platform_admin', managerId, targetId)).toBe(false)
  })

  it('Deputy does not see deactivation', () => {
    expect(canDeactivateStaff('deputy', 'teacher', managerId, targetId)).toBe(false)
  })

  it('Secretary does not see deactivation', () => {
    expect(canDeactivateStaff('secretary', 'teacher', managerId, targetId)).toBe(false)
  })

  it('Teacher does not see deactivation', () => {
    expect(canDeactivateStaff('teacher', 'teacher', managerId, targetId)).toBe(false)
  })

  it('canDeactivateStaff is gated in TEAM component source', () => {
    const team = read(TEAM)
    expect(team).toContain('canDeactivateStaff')
    // Deactivate UI is Manager-only
    expect(team).toContain("actorRole === 'institution_manager'")
  })

  it('canDeactivateStaff is gated in STAFF_MODAL source', () => {
    const modal = read(STAFF_MODAL)
    expect(modal).toContain('canDeactivate')
  })
})

// S3 req 3: LABELS
describe('S3 Hebrew labels (req 3)', () => {
  it('uses השבתת איש צוות not מחיקה', () => {
    const modal = read(DEACTIVATE_MODAL)
    expect(modal).toContain('השבתת איש צוות')
    expect(modal).not.toContain('מחיקה')
  })

  it('confirmation copy mentions data/history remain', () => {
    const modal = read(DEACTIVATE_MODAL)
    expect(modal).toContain('ההיסטוריה והנתונים הקיימים נשמרים')
  })

  it('confirmation copy mentions active requests will be released', () => {
    const modal = read(DEACTIVATE_MODAL)
    expect(modal).toContain('בקשות פעילות שבטיפולה ישוחררו אוטומטית')
  })

  it('confirmation copy says user cannot continue working', () => {
    const modal = read(DEACTIVATE_MODAL)
    expect(modal).toContain('לא תוכל להמשיך לעבוד במערכת')
  })

  it('action buttons are השבתה and ביטול', () => {
    const modal = read(DEACTIVATE_MODAL)
    expect(modal).toContain('השבתה')
    expect(modal).toContain('ביטול')
  })
})

// S3 req 4: CONFIRMATION FLOW
describe('S3 confirmation flow (req 4)', () => {
  it('confirmation is required before calling the RPC', () => {
    const modal = read(DEACTIVATE_MODAL)
    // RPC is called from handleConfirm, not on render
    expect(modal).toContain('handleConfirm')
    expect(modal).toContain('ConfirmDialog')
  })

  it('success triggers onSuccess refresh, not optimistic update', () => {
    const modal = read(DEACTIVATE_MODAL)
    expect(modal).toContain('onSuccess()')
    // Does not set local state to 'inactive' optimistically
    expect(modal).not.toContain("setMember({ ...member, status: 'inactive' }")
  })

  it('handles idempotent unchanged response without error', () => {
    const service = read(SERVICE)
    expect(service).toContain('unchanged')
    expect(service).toContain('result.unchanged')
  })
})

// S3 req 5: STAFF VISIBILITY — status badge in Team Management
describe('S3 staff visibility (req 5)', () => {
  it('status badge is shown for each user in Team Management', () => {
    const team = read(TEAM)
    expect(team).toContain('StatusBadge')
    expect(team).toContain('team-mgmt__status-badge')
  })

  it('status badge distinguishes active vs inactive', () => {
    const team = read(TEAM)
    expect(team).toContain('team-mgmt__status-badge--active')
    expect(team).toContain('team-mgmt__status-badge--inactive')
    expect(team).toContain("'פעיל'")
    expect(team).toContain("'לא פעיל'")
  })

  it('Team Management loads status from institutionUsers', () => {
    const iu = read(INSTITUTION_USERS)
    expect(iu).toContain("'id, full_name, email, primary_role, status'")
    expect(iu).not.toContain('national_id')
  })
})

// S3 req 6 (corrected): APP / SESSION UX — fail-closed inactive profile guard
describe('S3 fail-closed inactive session guard (req 6 corrected)', () => {
  it('App shows inactive-account screen only for explicit inactive status', () => {
    const app = read(APP)
    expect(app).toContain("currentProfile.status !== 'active'")
    expect(app).toContain('החשבון אינו פעיל')
  })

  it('inactive user can log out from the inactive screen', () => {
    const app = read(APP)
    expect(app).toContain('יציאה מהמערכת')
    const inactiveBlock = app.slice(
      app.indexOf("currentProfile.status !== 'active'"),
      app.indexOf('const loginSuccessTransition'),
    )
    expect(inactiveBlock).toContain('logout()')
  })

  it('profile service fetches status column', () => {
    const profile = read(PROFILE_SERVICE)
    expect(profile).toContain('select=id,full_name,primary_role,status,institution_id')
  })

  it('profile parsing rejects missing/null/unrecognized status — no fallback to active', () => {
    const profile = read(PROFILE_SERVICE)
    // Must not fall back to 'active' string
    expect(profile).not.toContain(": 'active'")
    // Must have the explicit validity check
    expect(profile).toContain("row.status !== 'active' && row.status !== 'inactive'")
    expect(profile).toContain("סטטוס חשבון לא ידוע")
  })

  it('AuthenticatedUserProfile.status type is a strict union, not string', () => {
    const types = read('src/types/user.ts')
    expect(types).toContain("UserAccountStatus = 'active' | 'inactive'")
    expect(types).toContain('status: UserAccountStatus')
  })

  it('platform_admin inactive guard precedes role routing', () => {
    const app = read(APP)
    const inactiveCheckPos = app.indexOf("currentProfile.status !== 'active'")
    const platformAdminPos = app.indexOf("currentProfile.role === 'platform_admin'")
    expect(inactiveCheckPos).toBeGreaterThan(0)
    expect(platformAdminPos).toBeGreaterThan(inactiveCheckPos)
  })
})

// S3 req 7: NO REACTIVATION
describe('S3 no reactivation (req 7)', () => {
  it('no reactivation UI in any frontend file', () => {
    const filesToCheck = [APP, TEAM, STAFF_MODAL, DEACTIVATE_MODAL, SERVICE, CAPABILITIES]
    for (const path of filesToCheck) {
      const src = read(path)
      expect(src).not.toMatch(/reactivat|reactivate|הפעלה מחדש|הפעל מחדש/i)
    }
  })
})

// S3 req 20: Phase 3 untouched
describe('S3 Phase 3 untouched (req 20)', () => {
  const PHASE3_FILES = [
    'src/services/schoolRegistrationQuotation.ts',
    'src/utils/schoolRegistrationQuotation.ts',
    'supabase/functions/_shared/quotationPdf.ts',
  ]

  it('S3 files do not reference Phase 3 paths', () => {
    const s3Files = [SERVICE, TEAM, STAFF_MODAL, DEACTIVATE_MODAL, CAPABILITIES]
    for (const path of s3Files) {
      const src = read(path)
      for (const phase3 of PHASE3_FILES) {
        expect(src).not.toContain(phase3.split('/').at(-1))
      }
    }
  })
})
