import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('recipient dashboard display for general_request', () => {
  const secretaryTableSource = readFileSync(
    resolve(process.cwd(), 'src/components/secretary/SecretaryRequestsTable.tsx'),
    'utf8',
  )
  const managerTableSource = readFileSync(
    resolve(process.cwd(), 'src/components/manager/ManagerRecentRequestsTable.tsx'),
    'utf8',
  )
  const analyticsSource = readFileSync(
    resolve(process.cwd(), 'src/services/analytics.ts'),
    'utf8',
  )
  const requestsSource = readFileSync(
    resolve(process.cwd(), 'src/services/requests.ts'),
    'utf8',
  )

  it('shows subject and message preview without extra per-row queries', () => {
    expect(secretaryTableSource).toContain('RequestSubjectMessagePreview')
    expect(managerTableSource).toContain('RequestSubjectMessagePreview')
    expect(analyticsSource).toMatch(
      /loadRecentRequests[\s\S]*request_payload[\s\S]*users!created_by_user_id/,
    )
    expect(requestsSource).toMatch(
      /loadSecretaryRequests[\s\S]*request_payload[\s\S]*users!created_by_user_id/,
    )
    expect(analyticsSource).not.toMatch(
      /loadRecentRequests[\s\S]*await supabase[\s\S]*await supabase/,
    )
  })
})
