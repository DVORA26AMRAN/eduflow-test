import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('manager recent requests analytics filtering', () => {
  it('excludes only the current manager personal archive from the recent-requests widget', () => {
    const analyticsSource = readFileSync(
      resolve(process.cwd(), 'src/services/analytics.ts'),
      'utf8',
    )

    const analyticsFn = analyticsSource.slice(
      analyticsSource.indexOf('export async function loadManagerAnalytics'),
      analyticsSource.indexOf('export async function loadRecentRequests'),
    )
    const recentRequestsFn = analyticsSource.slice(
      analyticsSource.indexOf('export async function loadRecentRequests'),
      analyticsSource.indexOf('export async function loadRecentRequestActivity'),
    )

    expect(analyticsFn).not.toContain('loadManagerPersonalArchivedRequestIds')
    expect(recentRequestsFn).toContain('loadManagerPersonalArchivedRequestIds')
    expect(recentRequestsFn).toContain('query.not(')
    expect(recentRequestsFn).not.toContain("is('archived_at', null)")
  })
})
