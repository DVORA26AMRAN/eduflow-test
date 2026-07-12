import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250712170000_create_request_messages.sql',
)

describe('request_messages migration', () => {
  const migration = readFileSync(migrationPath, 'utf8')

  it('creates request_messages with required fields', () => {
    expect(migration).toContain('CREATE TABLE public.request_messages')
    expect(migration).toContain('request_id')
    expect(migration).toContain('author_user_id')
    expect(migration).toContain('message')
    expect(migration).toContain('created_at')
    expect(migration).toContain('request_messages_message_not_blank')
  })

  it('enforces read and write access through auth_user_can_read_institution_request', () => {
    expect(migration).toContain('request_messages_select_authorized')
    expect(migration).toContain('request_messages_insert_authorized')
    expect(migration).toMatch(
      /request_messages_select_authorized[\s\S]*auth_user_can_read_institution_request\(request_id\)/,
    )
    expect(migration).toMatch(
      /request_messages_insert_authorized[\s\S]*author_user_id = auth\.uid\(\)/,
    )
    expect(migration).toMatch(
      /request_messages_insert_authorized[\s\S]*auth_user_can_read_institution_request\(request_id\)/,
    )
  })

  it('creates REQUEST_MESSAGE_RECEIVED notifications for other participants only', () => {
    expect(migration).toContain("'REQUEST_MESSAGE_RECEIVED'")
    expect(migration).toContain('create_request_message_notification')
    expect(migration).toMatch(
      /create_request_message_notification[\s\S]*recipient_user\.id <> NEW\.author_user_id/,
    )
    expect(migration).toMatch(
      /create_request_message_notification[\s\S]*recipient_user\.id = v_request\.created_by_user_id/,
    )
    expect(migration).toMatch(
      /create_request_message_notification[\s\S]*primary_role = 'secretary'/,
    )
    expect(migration).toMatch(
      /create_request_message_notification[\s\S]*primary_role = 'institution_manager'/,
    )
  })
})
