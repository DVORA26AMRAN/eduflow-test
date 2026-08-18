import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const ROLE_DASHBOARDS = [
  'src/pages/ManagerDashboardPage.tsx',
  'src/pages/SecretaryDashboardPage.tsx',
  'src/pages/TeacherDashboardPage.tsx',
  'src/pages/PlatformAdminDashboardPage.tsx',
] as const

describe('universal DashboardShell navigation architecture', () => {
  const shellTsx = read('src/components/dashboard/DashboardShell.tsx')
  const shellCss = read('src/components/dashboard/DashboardShell.css')

  it('implements one shared mobile menu + drawer path at <=1024px', () => {
    expect(shellTsx).toContain("'(max-width: 1024px)'")
    expect(shellTsx).toContain('dashboard-shell__mobile-nav-bar')
    expect(shellTsx).toContain('תפריט')
    expect(shellTsx).toContain('dashboard-shell__drawer')
    expect(shellTsx).toContain('setIsMobileNavOpen(false)')
    expect(shellCss).toContain('.dashboard-shell__mobile-nav-bar')
    expect(shellCss).toContain('.dashboard-shell__drawer')
    expect(shellCss).toContain('grid-template-columns: 272px minmax(0, 1fr)')
  })

  it('forbids the legacy horizontal mobile tab strip in shared shell CSS', () => {
    expect(shellCss).not.toMatch(
      /@media \(max-width:\s*1024px\)[\s\S]*?\.dashboard-shell__nav\s*\{[^}]*flex-direction:\s*row/s,
    )
    expect(shellCss).not.toMatch(
      /\.dashboard-shell__nav\s*\{[^}]*overflow-x:\s*auto/s,
    )
    expect(shellCss).not.toContain('scrollbar-width: none')
  })

  it('keeps desktop sidebar chrome and does not force mobile menu above 1024px via CSS alone', () => {
    expect(shellCss).toContain('grid-template-columns: 272px minmax(0, 1fr)')
    expect(shellTsx).toContain('!isMobileNav')
    expect(shellTsx).toContain('dashboard-shell__sidebar')
  })

  it('requires every current role dashboard to consume DashboardShell', () => {
    for (const pagePath of ROLE_DASHBOARDS) {
      const source = read(pagePath)
      expect(source).toContain("from '../components/dashboard/DashboardShell'")
      expect(source).toContain('<DashboardShell')
      expect(source).toContain('</DashboardShell>')
      expect(source).toContain('navItems=')
      // Architectural violation: role-owned mobile menu chrome
      expect(source).not.toContain('תפריט ניווט')
      expect(source).not.toContain('dashboard-shell__mobile-nav-bar')
      expect(source).not.toContain('overflow-x: auto')
    }
  })

  it('keeps App routing on shared role dashboards (no duplicate shell implementations)', () => {
    const app = read('src/App.tsx')
    expect(app).toContain("currentProfile.role === 'institution_manager'")
    expect(app).toContain('ManagerDashboardPage')
    expect(app).toContain('SecretaryDashboardPage')
    expect(app).toContain('TeacherDashboardPage')
    expect(app).toContain('PlatformAdminDashboardPage')
    expect(app).toContain("currentProfile.role === 'deputy'")
    expect(app).toContain('ManagerDashboardPage')
    expect(app).not.toContain('DeputyDashboardPlaceholderPage')
    expect(app).not.toContain('YaelDashboard')
    expect(app).not.toContain('AnnaDashboard')
  })
})

describe('dashboard content containment contracts', () => {
  it('contains shell/header/section surfaces without page-level overflow-x hacks', () => {
    const shellCss = read('src/components/dashboard/DashboardShell.css')
    const headerCss = read('src/components/dashboard/DashboardTopHeader.css')
    const sectionCss = read('src/components/dashboard/DashboardSection.css')
    const globalCss = read('src/design-system/global.css')

    for (const css of [shellCss, headerCss, sectionCss, globalCss]) {
      expect(css).not.toMatch(/overflow-x:\s*hidden/)
    }

    expect(shellCss).toMatch(/\.dashboard-shell\s*\{[^}]*min-width:\s*0/s)
    expect(shellCss).toMatch(/\.dashboard-shell__content\s*\{[^}]*min-width:\s*0/s)
    expect(shellCss).toMatch(/\.dashboard-shell__content\s*\{[^}]*max-width:\s*100%/s)
    expect(sectionCss).toMatch(/min-width:\s*0/)
    expect(sectionCss).toMatch(/max-width:\s*100%/)
  })

  it('keeps table and calendar scroll local to wrappers', () => {
    const tables = read('src/design-system/tables.css')
    const calendar = read('src/components/meetingCalendar/MeetingCalendar.css')
    const staff = read('src/components/staff/StaffDirectory.css')
    const manager = read('src/pages/ManagerDashboardPage.css')

    expect(tables).toMatch(/\.ds-table-wrapper\s*\{[^}]*overflow-x:\s*auto/s)
    expect(tables).toMatch(/\.ds-table-wrapper\s*\{[^}]*min-width:\s*0/s)
    expect(calendar).toMatch(/overflow-x:\s*auto/)
    expect(staff).toMatch(/\.staff-directory__table-wrapper\s*\{[^}]*min-width:\s*0/s)
    expect(manager).toMatch(/\.manager-dashboard__table-wrapper\s*\{[^}]*min-width:\s*0/s)
    expect(read('src/pages/SecretaryDashboardPage.css')).toMatch(
      /\.secretary-dashboard__table-wrapper\s*\{[^}]*min-width:\s*0/s,
    )
  })

  it('keeps role pages fluid for narrow phone widths (320–414) and desktop grids', () => {
    const manager = read('src/pages/ManagerDashboardPage.css')
    const secretary = read('src/pages/SecretaryDashboardPage.css')
    const teacher = read('src/pages/TeacherDashboardPage.css')
    const platform = read('src/pages/PlatformAdminDashboardPage.css')
    const schools = read('src/components/platform/PlatformAdminSchoolsSection.css')
    const shell = read('src/components/dashboard/DashboardShell.css')

    for (const css of [manager, secretary, teacher, platform]) {
      expect(css).toMatch(/min-width:\s*0/)
    }

    expect(manager).toContain('repeat(4, minmax(0, 1fr))')
    expect(manager).toContain('@media (max-width: 480px)')
    expect(teacher).toContain('minmax(min(180px, 100%), 1fr)')
    expect(schools).toContain('minmax(0, 1fr)')
    expect(schools).toContain('overflow-wrap: anywhere')
    expect(shell).toContain('@media (max-width: 1024px)')
    expect(shell).toContain('@media (max-width: 480px)')
    // Desktop IA width retained
    expect(shell).toContain('272px minmax(0, 1fr)')
  })

  it('documents phone and desktop breakpoint contracts used by the shared shell', () => {
    const shell = read('src/components/dashboard/DashboardShell.css')
    // Phone widths 320–414 are covered by the 480px + 1024px shell breakpoints.
    expect(shell).toContain('@media (max-width: 1024px)')
    expect(shell).toContain('@media (max-width: 480px)')
    expect(shell).toContain('@media (min-width: 1025px)')
    // Desktop 1366/1440 keep the 272px navigation column.
    expect(shell).toContain('grid-template-columns: 272px minmax(0, 1fr)')
    expect(shell).toContain('.dashboard-shell--mobile-nav .dashboard-shell__layout')
    expect(shell).toContain('#root:has(.dashboard-shell)')
  })
})
