import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250712161000_fix_general_request_recipient_role_cast.sql',
)

const originalMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250712160000_general_request_recipient_routing.sql',
)

describe('general_request recipient_role enum cast fix', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const originalMigration = readFileSync(originalMigrationPath, 'utf8')

  it('documents the user_role vs text mismatch in the original migration', () => {
    expect(originalMigration).toContain('recipient_role TEXT')
    expect(originalMigration).toContain('recipient_user.primary_role = NEW.recipient_role')
    expect(originalMigration).toContain('admin_user.primary_role = v_request.recipient_role')
  })

  it('casts recipient_role to public.user_role when comparing to primary_role', () => {
    expect(migration).toMatch(
      /create_general_request_notification[\s\S]*primary_role = NEW\.recipient_role::public\.user_role/,
    )
    expect(migration).toMatch(
      /send_request_reminder[\s\S]*primary_role = v_request\.recipient_role::public\.user_role/,
    )
  })

  it('does not leave uncorrected enum-to-text comparisons in function bodies', () => {
    const notificationFn =
      migration.match(
        /CREATE OR REPLACE FUNCTION public\.create_general_request_notification\(\)[\s\S]*?\$\$;/,
      )?.[0] ?? ''
    const reminderFn =
      migration.match(
        /CREATE OR REPLACE FUNCTION public\.send_request_reminder\(p_request_id UUID\)[\s\S]*?\$\$;/,
      )?.[0] ?? ''

    expect(notificationFn).not.toMatch(/primary_role = NEW\.recipient_role[^:]/)
    expect(reminderFn).not.toMatch(/primary_role = v_request\.recipient_role[^:]/)
  })
})
