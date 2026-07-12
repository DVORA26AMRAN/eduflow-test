import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

function extractFunction(source: string, functionName: string, nextFunctionName: string) {
  return source.slice(
    source.indexOf(`export async function ${functionName}`),
    source.indexOf(`export async function ${nextFunctionName}`),
  )
}

describe('manager active list independence from institutional archive', () => {
  const analyticsSource = readSource('src/services/analytics.ts')
  const requestsSource = readSource('src/services/requests.ts')
  const managerPersonalArchiveSource = readSource('src/services/managerPersonalArchive.ts')
  const managerRecentSectionSource = readSource(
    'src/components/manager/ManagerRecentRequestsSection.tsx',
  )
  const managerArchiveSectionSource = readSource(
    'src/components/manager/ManagerArchiveSection.tsx',
  )
  const managerSelectPolicySource = readSource(
    'supabase/migrations/20250702223000_requests_manager_select_policy.sql',
  )

  const recentRequestsFn = extractFunction(
    analyticsSource,
    'loadRecentRequests',
    'loadRecentRequestActivity',
  )
  const analyticsFn = extractFunction(
    analyticsSource,
    'loadManagerAnalytics',
    'loadRecentRequests',
  )

  it('does not filter manager active lists by shared requests.archived_at', () => {
    expect(recentRequestsFn).not.toContain("is('archived_at', null)")
    expect(recentRequestsFn).not.toContain('archived_by_user_id')
  })

  it('keeps institutionally archived secretary requests visible to the manager active list', () => {
    expect(recentRequestsFn).not.toContain("is('archived_at', null)")
    expect(requestsSource).toContain("loadSecretaryRequests")
    expect(requestsSource).toMatch(/loadSecretaryRequests[\s\S]*\.is\('archived_at', null\)/)
  })

  it('keeps teacher-archived requests visible to the manager active list', () => {
    expect(recentRequestsFn).not.toContain("is('archived_at', null)")
    expect(requestsSource).toMatch(/loadTeacherRequests[\s\S]*\.is\('archived_at', null\)/)
  })

  it('excludes only the current manager personal archive IDs from the active list', () => {
    expect(recentRequestsFn).toContain('loadManagerPersonalArchivedRequestIds')
    expect(recentRequestsFn).toContain('query.not(')
  })

  it('scopes personal archive exclusion per manager via manager_archived_requests', () => {
    expect(managerPersonalArchiveSource).toContain(".eq('manager_user_id', sessionData.session.user.id)")
    expect(recentRequestsFn).toContain('loadManagerPersonalArchivedRequestIds')
  })

  it('allows personal manager archiving without touching shared archive fields', () => {
    expect(managerPersonalArchiveSource).toContain("from('manager_archived_requests')")
    expect(managerPersonalArchiveSource).not.toContain("from('requests')")
    expect(managerPersonalArchiveSource).not.toContain('archived_by_user_id')
  })

  it('loads personal archive screen only from manager_archived_requests', () => {
    expect(managerArchiveSectionSource).toContain('loadManagerPersonalArchivedRequests')
    expect(managerArchiveSectionSource).not.toContain('loadSecretaryArchivedRequests')
    expect(managerArchiveSectionSource).not.toContain("archived_at', null")
  })

  it('keeps teacher and secretary active/archive queries unchanged', () => {
    expect(requestsSource).toMatch(/loadTeacherRequests[\s\S]*\.is\('archived_at', null\)/)
    expect(requestsSource).toMatch(/loadSecretaryRequests[\s\S]*\.is\('archived_at', null\)/)
    expect(requestsSource).toMatch(/loadSecretaryArchivedRequests[\s\S]*\.not\('archived_at', 'is', null\)/)
  })

  it('keeps institution-wide analytics independent from archive visibility filters', () => {
    expect(analyticsFn).not.toContain('loadManagerPersonalArchivedRequestIds')
    expect(analyticsFn).not.toContain("is('archived_at', null)")
  })

  it('preserves manager refresh behavior and does not reintroduce shared archive filters in UI', () => {
    expect(managerRecentSectionSource).toContain('refreshToken')
    expect(managerRecentSectionSource).toContain('loadRecentRequests')
    expect(managerRecentSectionSource).not.toContain('archived_at')
  })

  it('permits manager SELECT on institution requests regardless of archived_at', () => {
    expect(managerSelectPolicySource).toContain('requests_manager_select_institution')
    expect(managerSelectPolicySource).not.toContain('archived_at')
  })
})
