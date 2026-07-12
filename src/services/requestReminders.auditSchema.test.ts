import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250712153000_fix_request_reminder_audit_logs_action_type.sql',
)

describe('request reminder audit_logs action_type fix', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const auditInsert =
    migration.match(/INSERT INTO public\.audit_logs[\s\S]*?\);/)?.[0] ?? ''

  it('writes audit rows using actor_user_id instead of user_id', () => {
    expect(auditInsert).toMatch(/actor_user_id,\s*\r?\n\s*action_type/)
    expect(auditInsert).not.toMatch(/^\s*user_id,/m)
  })

  it('populates mandatory action_type with the established reminder action value', () => {
    expect(auditInsert).toMatch(/action_type,\s*\r?\n\s*entity_type/)
    expect(auditInsert).toContain("'request_reminder_sent'")
    expect(auditInsert).not.toMatch(/\baction,\s*\n\s*entity_type/)
  })

  it('keeps reminder context in metadata alongside action_type', () => {
    expect(auditInsert).toContain("'action', 'request_reminder_sent'")
    expect(auditInsert).toContain("'reminder_count', v_reminder_number")
  })

  it('keeps mandatory transactional audit behavior', () => {
    expect(migration).toContain('Audit policy for send_request_reminder: mandatory (transactional)')
    expect(migration).not.toMatch(/EXCEPTION\s+WHEN/)
    expect(migration).not.toContain('RAISE WARNING')
  })

  it('preserves eligible statuses and JSON response contract', () => {
    expect(migration).toContain("status NOT IN ('new', 'in_progress')")
    expect(migration).toContain("'ok', true")
    expect(migration).toContain("'reminder_count', v_reminder_number")
    expect(migration).toContain("'created_at', NOW()")
  })
})
