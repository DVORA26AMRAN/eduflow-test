import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250712160000_general_request_recipient_routing.sql',
)

describe('general_request recipient routing migration', () => {
  const migration = readFileSync(migrationPath, 'utf8')

  it('adds recipient_role with approved values and general_request type', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS recipient_role TEXT')
    expect(migration).toContain("'general_request'")
    expect(migration).toContain("recipient_role IN ('secretary', 'institution_manager')")
    expect(migration).toContain('requests_general_request_recipient_required')
    expect(migration).toContain('requests_non_general_request_recipient_null')
  })

  it('narrows secretary and manager SELECT policies by recipient_role', () => {
    expect(migration).toMatch(
      /CREATE POLICY requests_manager_select_institution[\s\S]*recipient_role = 'institution_manager'/,
    )
    expect(migration).toMatch(
      /CREATE POLICY requests_secretary_select_institution[\s\S]*recipient_role = 'secretary'/,
    )
    expect(migration).toMatch(
      /CREATE POLICY requests_secretary_select_archived_institution[\s\S]*recipient_role = 'secretary'/,
    )
  })

  it('keeps non-general request types institution-visible to both roles', () => {
    expect(migration).toContain('request_type <> \'general_request\'')
  })

  it('enforces teacher insert validation for general_request fields', () => {
    expect(migration).toContain('enforce_requests_teacher_insert_columns')
    expect(migration).toContain('general_request requires a valid recipient_role.')
    expect(migration).toContain('general_request requires a subject.')
    expect(migration).toContain('general_request requires a message.')
    expect(migration).toContain('recipient_role is only allowed for general_request.')
  })

  it('routes attachment and storage access through auth_user_can_read_institution_request', () => {
    expect(migration).toContain('auth_user_can_read_institution_request')
    expect(migration).toContain('request_attachments_manager_select_institution')
    expect(migration).toContain('request_attachments_storage_recipient_select')
  })

  it('notifies only the selected recipient role on create', () => {
    expect(migration).toContain('create_general_request_notification')
    expect(migration).toContain("'REQUEST_CREATED'")
    expect(migration).toMatch(
      /create_general_request_notification[\s\S]*primary_role = NEW\.recipient_role/,
    )
  })

  it('fans out reminders only to the routed recipient role for general_request', () => {
    expect(migration).toMatch(
      /send_request_reminder[\s\S]*v_request\.request_type = 'general_request'[\s\S]*recipient_role/,
    )
  })
})
