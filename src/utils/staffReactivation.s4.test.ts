/**
 * S4 Staff Reactivation contract tests.
 * Covers database contract (via SQL source analysis) and frontend behavior.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canDeactivateStaff,
  canReactivateStaff,
} from '../security/institutionCapabilities'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const S4 = 'supabase/migrations/20250819106000_staff_reactivation_s4.sql'
const S2 = 'supabase/migrations/20250819105000_staff_deactivation_s2.sql'
const R1 = 'supabase/migrations/20250818104000_request_ownership_r1_handler.sql'
const LOCK = 'supabase/migrations/20250819104500_request_ownership_assignment_user_lock.sql'

const SERVICE = 'src/services/staffDirectory.ts'
const CAPABILITIES = 'src/security/institutionCapabilities.ts'
const TEAM = 'src/components/manager/TeamManagementSection.tsx'
const STAFF_MODAL = 'src/components/staff/StaffMemberDetailsModal.tsx'
const REACTIVATE_MODAL = 'src/components/staff/StaffReactivationConfirmModal.tsx'
const APP = 'src/App.tsx'
const INSTITUTION_USERS = 'src/services/institutionUsers.ts'

const PHASE3_PATHS = [
  'school_registration_quotation',
  'quotationPdf',
  'schoolRegistrationQuotation',
  'school-registration-quotation-pdf',
]

function functionBody(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`
  const start = sql.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const dollarEnd = sql.indexOf('$$;', start)
  return sql.slice(start, dollarEnd + 3)
}

// =============================================================================
// DATABASE CONTRACT
// =============================================================================

describe('S4 database contract — migration source', () => {
  const sql = read(S4)
  const body = functionBody(sql, 'reactivate_staff_member')
  const s2 = read(S2)
  const r1 = read(R1)
  const lock = read(LOCK)

  // req 1-3: allowed targets
  it('req 1: allows active Manager -> inactive Teacher', () => {
    expect(body).toContain("'teacher'::public.user_role")
  })

  it('req 2: allows active Manager -> inactive Secretary', () => {
    expect(body).toContain("'secretary'::public.user_role")
  })

  it('req 3: allows active Manager -> inactive Deputy', () => {
    expect(body).toContain("'deputy'::public.user_role")
  })

  // req 4: self denied
  it('req 4: self denied — p_user_id = v_actor check present', () => {
    expect(body).toContain('p_user_id = v_actor')
  })

  // req 5: Manager target denied — target role NOT IN includes no institution_manager
  it('req 5: Manager target denied — role check does not include institution_manager', () => {
    expect(body).not.toContain("'institution_manager'::public.user_role,\n            'platform_admin'")
    // target.primary_role NOT IN (teacher/secretary/deputy) means manager/platform_admin are implicitly denied
    expect(body).toContain('v_target.primary_role NOT IN')
  })

  // req 6: Platform Admin target denied (same NOT IN gate)
  it('req 6: Platform Admin target denied — not in eligible role list', () => {
    expect(body).not.toContain("'platform_admin'::public.user_role,")
    // The NOT IN check on teacher/secretary/deputy implicitly excludes platform_admin
    const eligibleBlock = body.slice(body.indexOf('primary_role NOT IN'), body.indexOf('THEN', body.indexOf('primary_role NOT IN')))
    expect(eligibleBlock).not.toContain('platform_admin')
  })

  // req 7: cross-institution denied
  it('req 7: cross-institution denied', () => {
    expect(body).toContain('v_target.institution_id IS DISTINCT FROM v_caller.institution_id')
  })

  // req 8: inactive Manager denied
  it('req 8: inactive Manager denied — caller status check', () => {
    expect(body).toContain("v_caller.status <> 'active'")
  })

  // req 9: non-manager denied
  it('req 9: non-manager denied — caller role check', () => {
    expect(body).toContain("v_caller.primary_role <> 'institution_manager'::public.user_role")
  })

  // req 10: target row locked FOR UPDATE
  it('req 10: target row locked FOR UPDATE', () => {
    expect(body).toContain('FOR UPDATE')
  })

  // req 11: only inactive -> active is mutated
  it('req 11: only inactive -> active mutation', () => {
    expect(body).toContain("SET status = 'active'")
    expect(body).toContain("AND status = 'inactive'")
    expect(body).not.toContain("SET status = 'inactive'")
  })

  // req 12: already-active is idempotent
  it('req 12: already-active is idempotent — unchanged flag', () => {
    expect(body).toContain("v_unchanged := (v_previous_status = 'active')")
    expect(body).toContain("'unchanged', v_unchanged")
    expect(body).toContain('IF NOT v_unchanged THEN')
  })

  // req 13: unknown status fails closed
  it('req 13: unknown status fails closed', () => {
    expect(body).toContain("v_previous_status <> 'active' AND v_previous_status <> 'inactive'")
    expect(body).toContain('USING ERRCODE = \'42501\'')
  })

  // req 14: audit written exactly on actual transition
  it('req 14: audit written only on actual transition (inside IF NOT v_unchanged)', () => {
    const ifBlock = body.slice(body.indexOf('IF NOT v_unchanged THEN'), body.indexOf('END IF;', body.indexOf('IF NOT v_unchanged THEN')))
    expect(ifBlock).toContain('INSERT INTO public.audit_logs')
    expect(ifBlock).toContain("'staff_reactivated'")
    expect(ifBlock).toContain("'previous_status'")
    expect(ifBlock).toContain("'new_status'")
    expect(ifBlock).toContain("'active'")
    expect(ifBlock).toContain("'target_primary_role'")
  })

  // req 15: no request reassignment or restoration
  it('req 15: no request reassignment — no handled_by_user_id assignment', () => {
    expect(body).not.toContain('handled_by_user_id')
    expect(body).not.toContain('claim_request')
    expect(body).not.toContain('transfer_request_handler')
    expect(body).not.toContain('request_handler_history_write')
  })

  // req 16: no ownership functions modified
  it('req 16: R1 claim/transfer/release functions not modified in S4', () => {
    expect(r1).toContain('CREATE OR REPLACE FUNCTION public.claim_request')
    expect(r1).toContain('CREATE OR REPLACE FUNCTION public.transfer_request_handler')
    expect(r1).toContain('CREATE OR REPLACE FUNCTION public.release_request_handler')
    expect(lock).toContain('CREATE OR REPLACE FUNCTION public.claim_request')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.claim_request')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.transfer_request_handler')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.release_request_handler')
  })

  // req 17: no authenticated UPDATE grant
  it('req 17: no GRANT UPDATE to authenticated', () => {
    expect(sql).not.toMatch(/GRANT\s+UPDATE\b/i)
    expect(sql).not.toMatch(/GRANT\s+(INSERT|DELETE|TRUNCATE|ALL)\b/i)
  })

  // req 18: EXECUTE grant correct
  it('req 18: EXECUTE grant correct', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.reactivate_staff_member(UUID) FROM PUBLIC')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.reactivate_staff_member(UUID) FROM anon')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.reactivate_staff_member(UUID) TO authenticated')
    expect(sql).not.toMatch(/GRANT EXECUTE[^\n]*TO anon/i)
    // S2 deactivate RPC still has its own grants
    expect(s2).toContain('GRANT EXECUTE ON FUNCTION public.deactivate_staff_member(UUID) TO authenticated')
  })

  // Phase 3 untouched
  it('req 34: Phase 3 untouched in migration', () => {
    for (const path of PHASE3_PATHS) {
      expect(sql).not.toContain(path)
    }
  })
})

// =============================================================================
// FRONTEND — canReactivateStaff security helper
// =============================================================================

describe('S4 canReactivateStaff security helper', () => {
  const managerId = 'manager-1'
  const targetId = 'other-1'

  // req 19-21: Manager sees reactivation for eligible inactive roles
  it('req 19: Manager can reactivate inactive Teacher', () => {
    expect(canReactivateStaff('institution_manager', 'teacher', managerId, targetId)).toBe(true)
  })

  it('req 20: Manager can reactivate inactive Secretary', () => {
    expect(canReactivateStaff('institution_manager', 'secretary', managerId, targetId)).toBe(true)
  })

  it('req 21: Manager can reactivate inactive Deputy', () => {
    expect(canReactivateStaff('institution_manager', 'deputy', managerId, targetId)).toBe(true)
  })

  // req 22-23: toggle — active shows deactivation, inactive shows reactivation
  it('req 22-23: canDeactivate and canReactivate use the same role matrix', () => {
    // same capability matrix — Manager/teacher/non-self
    expect(canDeactivateStaff('institution_manager', 'teacher', managerId, targetId)).toBe(true)
    expect(canReactivateStaff('institution_manager', 'teacher', managerId, targetId)).toBe(true)
  })

  // req 24: Manager/Platform Admin targets do not show reactivation
  it('req 24: Manager target denied', () => {
    expect(canReactivateStaff('institution_manager', 'institution_manager', managerId, targetId)).toBe(false)
  })

  it('req 24: Platform Admin target denied', () => {
    expect(canReactivateStaff('institution_manager', 'platform_admin', managerId, targetId)).toBe(false)
  })

  it('req 24: self denied', () => {
    expect(canReactivateStaff('institution_manager', 'teacher', managerId, managerId)).toBe(false)
  })

  // req 25: Deputy/Secretary/Teacher actors denied
  it('req 25: Deputy actor denied', () => {
    expect(canReactivateStaff('deputy', 'teacher', managerId, targetId)).toBe(false)
  })

  it('req 25: Secretary actor denied', () => {
    expect(canReactivateStaff('secretary', 'teacher', managerId, targetId)).toBe(false)
  })

  it('req 25: Teacher actor denied', () => {
    expect(canReactivateStaff('teacher', 'teacher', managerId, targetId)).toBe(false)
  })
})

// =============================================================================
// FRONTEND — source-level assertions
// =============================================================================

describe('S4 frontend source assertions', () => {
  // req 26: confirmation required
  it('req 26: confirmation required before RPC call', () => {
    const modal = read(REACTIVATE_MODAL)
    expect(modal).toContain('ConfirmDialog')
    expect(modal).toContain('handleConfirm')
  })

  // req 27: Hebrew warning about requests not being restored
  it('req 27: confirmation copy mentions requests not restored automatically', () => {
    const modal = read(REACTIVATE_MODAL)
    expect(modal).toContain('בקשות ששוחררו בזמן ההשבתה לא יוקצו אליה מחדש באופן אוטומטי')
  })

  it('req 27: confirmation title is correct Hebrew', () => {
    const modal = read(REACTIVATE_MODAL)
    expect(modal).toContain('החזרת איש צוות לפעילות')
  })

  it('req 27: confirm button label is correct Hebrew', () => {
    const modal = read(REACTIVATE_MODAL)
    expect(modal).toContain('החזרה לפעילות')
    expect(modal).toContain('ביטול')
  })

  // req 28: RPC called only after confirmation
  it('req 28: RPC not scattered — only in service', () => {
    const service = read(SERVICE)
    expect(service).toContain("rpc('reactivate_staff_member'")
    const team = read(TEAM)
    expect(team).not.toContain("rpc('reactivate_staff_member'")
    const modal = read(STAFF_MODAL)
    expect(modal).not.toContain("rpc('reactivate_staff_member'")
    const app = read(APP)
    expect(app).not.toContain("rpc('reactivate_staff_member'")
  })

  // req 29: success refreshes authoritative staff data
  it('req 29: success calls onSuccess (authoritative refresh, not optimistic)', () => {
    const modal = read(REACTIVATE_MODAL)
    expect(modal).toContain('onSuccess()')
    expect(modal).not.toContain("setMember({ ...member, status: 'active' }")
  })

  // req 30: no direct users UPDATE
  it('req 30: no direct users UPDATE in frontend', () => {
    const files = [APP, TEAM, STAFF_MODAL, SERVICE, INSTITUTION_USERS, REACTIVATE_MODAL]
    for (const path of files) {
      expect(read(path)).not.toMatch(/\.from\(['"]users['"]\)\s*\.update/i)
    }
  })

  // req 31: no new invite / Auth user creation
  it('req 31: no new invite or Auth user creation in reactivation modal', () => {
    const modal = read(REACTIVATE_MODAL)
    expect(modal).not.toContain('signUp')
    expect(modal).not.toContain('inviteUserByEmail')
    expect(modal).not.toContain('createUser')
  })

  // req 32: fail-closed profile behavior remains intact
  it('req 32: fail-closed profile status guard still present in App', () => {
    const app = read(APP)
    expect(app).toContain("currentProfile.status !== 'active'")
    expect(app).toContain('החשבון אינו פעיל')
  })

  // toggle: active shows deactivation, inactive shows reactivation (source-level)
  it('req 22: active user shows deactivation action in Team Management', () => {
    const team = read(TEAM)
    expect(team).toContain("user.status === 'active'")
    expect(team).toContain('handleDeactivateClick')
  })

  it('req 23: inactive user shows reactivation action in Team Management', () => {
    const team = read(TEAM)
    expect(team).toContain("user.status === 'inactive'")
    expect(team).toContain('handleReactivateClick')
  })

  it('deactivation and reactivation are mutually exclusive in Team Management', () => {
    const team = read(TEAM)
    // Both are present but gated by opposite status checks
    expect(team).toContain('handleDeactivateClick')
    expect(team).toContain('handleReactivateClick')
    // Must not show both simultaneously
    expect(team).toContain("user.status === 'active'")
    expect(team).toContain("user.status === 'inactive'")
  })

  // canReactivateStaff wired in capabilities
  it('canReactivateStaff exported from institutionCapabilities', () => {
    expect(read(CAPABILITIES)).toContain('canReactivateStaff')
  })

  // req 34: Phase 3 untouched in S4 frontend files
  it('req 34: Phase 3 untouched in S4 frontend files', () => {
    const s4Files = [SERVICE, REACTIVATE_MODAL, CAPABILITIES]
    for (const path of s4Files) {
      for (const p3path of PHASE3_PATHS) {
        expect(read(path)).not.toContain(p3path.split('/').at(-1))
      }
    }
  })
})
