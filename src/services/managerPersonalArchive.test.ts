import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('manager personal archive implementation', () => {
  it('uses manager_archived_requests instead of shared request archive fields', () => {
    const serviceSource = readFileSync(
      resolve(process.cwd(), 'src/services/managerPersonalArchive.ts'),
      'utf8',
    )
    const requestsSource = readFileSync(
      resolve(process.cwd(), 'src/services/requests.ts'),
      'utf8',
    )

    expect(serviceSource).toContain("from('manager_archived_requests')")
    expect(serviceSource).toContain('.insert({')
    expect(serviceSource).not.toContain('archived_by_user_id')
    expect(serviceSource).not.toContain("from('requests')")
    expect(requestsSource).not.toContain('archiveRequestAsManager')
    expect(requestsSource).not.toContain('loadManagerArchivedRequests')
  })

  it('does not update requests.archived_at or requests.archived_by_user_id', () => {
    const serviceSource = readFileSync(
      resolve(process.cwd(), 'src/services/managerPersonalArchive.ts'),
      'utf8',
    )

    expect(serviceSource).not.toContain('archived_by_user_id')
    expect(serviceSource).not.toContain("from('requests')")
    expect(serviceSource).not.toContain('.delete(')
  })

  it('defines replacement migration and drops the rejected shared-field policy', () => {
    const migrationSource = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20250712140000_manager_personal_archive.sql',
      ),
      'utf8',
    )

    expect(migrationSource).toContain('CREATE TABLE public.manager_archived_requests')
    expect(migrationSource).toContain('PRIMARY KEY (manager_user_id, request_id)')
    expect(migrationSource).toContain(
      'DROP POLICY IF EXISTS requests_manager_archive_completed_or_rejected_institution',
    )
    expect(migrationSource).toContain('manager_archived_requests_insert_own_institution')
    expect(migrationSource).toContain('manager_user_id = auth.uid()')
  })

  it('keeps teacher and secretary shared archive behavior unchanged', () => {
    const requestsSource = readFileSync(
      resolve(process.cwd(), 'src/services/requests.ts'),
      'utf8',
    )

    expect(requestsSource).toContain('export async function archiveRequest(')
    expect(requestsSource).toContain('export async function archiveRequestAsSecretary(')
    expect(requestsSource).toContain('archived_at: archivedAt')
    expect(requestsSource).toContain('archived_by_user_id: userId')
  })
})
