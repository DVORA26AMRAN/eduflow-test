import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const gateMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250813120000_release_gate1_multi_institution_isolation.sql',
)
const legacyAttachmentStoragePath = resolve(
  process.cwd(),
  'supabase/migrations/20250703113000_request_attachments_storage_policies.sql',
)
const routingMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250712160000_general_request_recipient_routing.sql',
)
const edgeInvitePath = resolve(process.cwd(), 'supabase/functions/clever-processor/index.ts')
const reminderDispatcherPath = resolve(
  process.cwd(),
  'supabase/functions/meeting-reminder-dispatcher/index.ts',
)
const configPath = resolve(process.cwd(), 'supabase/config.toml')
const supabaseClientPath = resolve(process.cwd(), 'src/services/supabase.ts')
const appPath = resolve(process.cwd(), 'src/App.tsx')
const institutionAdminPath = resolve(process.cwd(), 'src/services/institutionAdmin.ts')

describe('release gate 1 — multi-institution isolation', () => {
  const gate = readFileSync(gateMigrationPath, 'utf8')
  const legacyStorage = readFileSync(legacyAttachmentStoragePath, 'utf8')
  const routing = readFileSync(routingMigrationPath, 'utf8')
  const edgeInvite = readFileSync(edgeInvitePath, 'utf8')
  const reminderDispatcher = readFileSync(reminderDispatcherPath, 'utf8')
  const config = readFileSync(configPath, 'utf8')
  const supabaseClient = readFileSync(supabaseClientPath, 'utf8')
  const appSource = readFileSync(appPath, 'utf8')
  const institutionAdmin = readFileSync(institutionAdminPath, 'utf8')

  it('documents the historical role-only request-attachments storage hole', () => {
    expect(legacyStorage).toContain('request_attachments_storage_teacher_select')
    expect(legacyStorage).toContain('auth_user_is_active_teacher()')
    expect(routing).toContain('request_attachments_storage_recipient_select')
    expect(routing).toContain('auth_user_is_active_teacher()')
  })

  it('hardens request-attachments storage to request + path institution binding', () => {
    expect(gate).toContain('DROP POLICY IF EXISTS request_attachments_storage_teacher_select')
    expect(gate).toContain('DROP POLICY IF EXISTS request_attachments_storage_teacher_insert')
    expect(gate).toContain('DROP POLICY IF EXISTS request_attachments_storage_recipient_select')
    expect(gate).toContain('request_attachments_storage_authorized_select')
    expect(gate).toContain('auth_user_can_read_institution_request')
    expect(gate).toContain('institution_id_from_attachment_storage_path')
    expect(gate).toContain('r.institution_id = public.institution_id_from_attachment_storage_path(name)')
    expect(gate).toContain('auth_user_is_active_teacher_for_institution')
    expect(gate).not.toContain('CREATE POLICY request_attachments_storage_teacher_select')
    expect(gate).not.toContain('CREATE POLICY request_attachments_storage_recipient_select')
    const insertPolicyStart = gate.indexOf('CREATE POLICY request_attachments_storage_teacher_insert')
    const selectPolicyStart = gate.indexOf('CREATE POLICY request_attachments_storage_authorized_select')
    expect(insertPolicyStart).toBeGreaterThanOrEqual(0)
    expect(selectPolicyStart).toBeGreaterThanOrEqual(0)
    const insertPolicy = gate.slice(insertPolicyStart, selectPolicyStart)
    expect(insertPolicy).not.toContain('auth_user_is_active_teacher()')
    expect(insertPolicy).toContain('auth_user_is_active_teacher_for_institution')
  })

  it('binds printing-files path institution to printing_request.institution_id', () => {
    expect(gate).toContain('printing_files_teacher_insert')
    expect(gate).toContain('printing_files_teacher_select')
    expect(gate).toContain('printing_files_staff_select')
    expect(gate).toContain(
      'r.institution_id = public.printing_institution_id_from_storage_path(name)',
    )
  })

  it('restricts meeting_calendar_user_profile to self or same institution', () => {
    expect(gate).toContain('CREATE OR REPLACE FUNCTION public.meeting_calendar_user_profile')
    expect(gate).toContain('u.id = auth.uid()')
    expect(gate).toContain('u.institution_id = (')
    expect(gate).toContain('caller.institution_id')
  })

  it('overwrites teacher request institution_id from caller (no client override)', () => {
    expect(gate).toContain('NEW.institution_id := v_caller_institution_id')
    expect(gate).toContain("u.primary_role = 'teacher'")
    expect(gate).toContain("u.status = 'active'")
  })

  it('rejects tenant clever-processor body.institution_id override', () => {
    expect(edgeInvite).toContain('body.institution_id !== undefined && body.institution_id !== null')
    expect(edgeInvite).toContain("return jsonResponse({ ok: false, error: 'forbidden' }, 403)")
    expect(edgeInvite).toContain('institution_id: callerRow.institution_id')
    expect(edgeInvite).toContain('isActiveGlobalPlatformAdmin')
    expect(edgeInvite).toContain('isActiveTenantInviter')
  })

  it('gates meeting-reminder-dispatcher on service_role JWT', () => {
    expect(reminderDispatcher).toContain('requireServiceRoleJwt')
    expect(config).toContain('[functions.meeting-reminder-dispatcher]')
    expect(config).toMatch(
      /\[functions\.meeting-reminder-dispatcher\]\s*\nverify_jwt = true/,
    )
  })

  it('keeps service_role secret out of frontend sources', () => {
    expect(supabaseClient).not.toMatch(/SERVICE_ROLE/)
    expect(appSource).not.toMatch(/SERVICE_ROLE/)
    expect(institutionAdmin).not.toMatch(/SERVICE_ROLE/)
    expect(edgeInvite).toContain("requireEnv('SUPABASE_SERVICE_ROLE_KEY')")
  })

  it('ships gate migration file', () => {
    expect(existsSync(gateMigrationPath)).toBe(true)
  })
})
