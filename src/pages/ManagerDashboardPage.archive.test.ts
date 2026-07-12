import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('manager dashboard archive scope', () => {
  it('extends only the institution manager dashboard with personal archive services', () => {
    const managerPage = readFileSync(
      resolve(process.cwd(), 'src/pages/ManagerDashboardPage.tsx'),
      'utf8',
    )
    const teacherPage = readFileSync(
      resolve(process.cwd(), 'src/pages/TeacherDashboardPage.tsx'),
      'utf8',
    )
    const secretaryPage = readFileSync(
      resolve(process.cwd(), 'src/pages/SecretaryDashboardPage.tsx'),
      'utf8',
    )
    const analyticsSource = readFileSync(
      resolve(process.cwd(), 'src/services/analytics.ts'),
      'utf8',
    )

    expect(managerPage).toContain('ManagerArchiveSection')
    expect(managerPage).toContain('ManagerRecentRequestsSection')
    expect(teacherPage).not.toContain('managerPersonalArchive')
    expect(secretaryPage).not.toContain('managerPersonalArchive')
    expect(analyticsSource).not.toContain('manager_archived_requests')
    expect(analyticsSource).not.toMatch(
      /loadManagerAnalytics[\s\S]*managerPersonalArchivedRequestIds/,
    )
  })
})
