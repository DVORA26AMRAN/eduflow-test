import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readCss(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('mobile responsive hardening guards', () => {
  it('does not use page-level overflow-x:hidden on dashboard chrome', () => {
    const shell = readCss('src/components/dashboard/DashboardShell.css')
    const header = readCss('src/components/dashboard/DashboardTopHeader.css')
    const globalCss = readCss('src/design-system/global.css')

    expect(shell).not.toMatch(/overflow-x:\s*hidden/)
    expect(header).not.toMatch(/overflow-x:\s*hidden/)
    expect(globalCss).not.toMatch(/overflow-x:\s*hidden/)
  })

  it('keeps intentional local horizontal scroll for tables and calendar', () => {
    const shell = readCss('src/components/dashboard/DashboardShell.css')
    const tables = readCss('src/design-system/tables.css')
    const calendar = readCss('src/components/meetingCalendar/MeetingCalendar.css')

    expect(shell).not.toMatch(/\.dashboard-shell__nav\s*\{[^}]*overflow-x:\s*auto/s)
    expect(shell).toContain('.dashboard-shell__drawer')
    expect(tables).toContain('overflow-x: auto')
    expect(calendar).toMatch(/\.mc-month[\s\S]*overflow-x:\s*auto/)
    expect(calendar).toMatch(/\.mc-week[\s\S]*overflow-x:\s*auto/)
  })

  it('lets the top header identity shrink so ellipsis can work', () => {
    const header = readCss('src/components/dashboard/DashboardTopHeader.css')

    expect(header).toMatch(
      /\.dashboard-top-header__leading\s*\{[^}]*flex:\s*1\s+1\s+auto/s,
    )
    expect(header).toMatch(
      /\.dashboard-top-header__leading\s*\{[^}]*min-width:\s*0/s,
    )
    expect(header).not.toMatch(
      /\.dashboard-top-header__leading\s*\{[^}]*flex-shrink:\s*0/s,
    )
  })

  it('removes nested role-page inline padding under the shell', () => {
    const shell = readCss('src/components/dashboard/DashboardShell.css')

    expect(shell).toContain('padding-inline: 0')
    expect(shell).toContain('.teacher-dashboard')
    expect(shell).toContain('.secretary-dashboard')
    expect(shell).toContain('.manager-dashboard')
    expect(shell).toContain('.platform-admin-dashboard')
  })

  it('keeps platform admin schools cards fluid without page overflow hacks', () => {
    const page = readCss('src/pages/PlatformAdminDashboardPage.css')
    const schools = readCss('src/components/platform/PlatformAdminSchoolsSection.css')

    expect(page).toContain('min-width: 0')
    expect(page).not.toMatch(/overflow-x:\s*hidden/)
    expect(schools).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(schools).toContain('overflow-wrap: anywhere')
    expect(schools).not.toMatch(/overflow-x:\s*hidden/)
  })

  it('uses fluid minmax for dense teacher grids', () => {
    const teacher = readCss('src/pages/TeacherDashboardPage.css')
    const printing = readCss('src/components/teacher/printing/printing.css')

    expect(teacher).toContain('minmax(min(180px, 100%), 1fr)')
    expect(printing).toContain('minmax(min(220px, 100%), 1fr)')
  })
})
