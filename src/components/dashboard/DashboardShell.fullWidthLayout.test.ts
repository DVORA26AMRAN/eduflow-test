import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('DashboardShell desktop full-width layout', () => {
  const shellCss = read('src/components/dashboard/DashboardShell.css')
  const shellTsx = read('src/components/dashboard/DashboardShell.tsx')
  const headerCss = read('src/components/dashboard/DashboardTopHeader.css')
  const indexCss = read('src/index.css')
  const loginCss = read('src/pages/LoginPage.css')
  const loginTsx = read('src/pages/LoginPage.tsx')

  it('keeps a single shared shell for every role dashboard', () => {
    for (const pagePath of [
      'src/pages/ManagerDashboardPage.tsx',
      'src/pages/SecretaryDashboardPage.tsx',
      'src/pages/TeacherDashboardPage.tsx',
      'src/pages/PlatformAdminDashboardPage.tsx',
    ]) {
      const source = read(pagePath)
      expect(source).toContain('<DashboardShell')
      expect(source).not.toContain('1126px')
    }
  })

  it('lifts the centered max-width shell only on desktop (>=1025px)', () => {
    expect(shellCss).toContain('max-width: 1400px')
    expect(shellCss).toContain('@media (min-width: 1025px)')
    expect(shellCss).toMatch(
      /@media \(min-width:\s*1025px\)[\s\S]*?\.dashboard-shell\s*\{[^}]*max-width:\s*none/s,
    )
    expect(shellCss).toMatch(
      /@media \(min-width:\s*1025px\)[\s\S]*?#root:has\(\.dashboard-shell\)\s*\{[^}]*width:\s*100%/s,
    )
    expect(shellCss).not.toMatch(/margin-inline:\s*-\d/)
    expect(shellCss).not.toMatch(/transform:\s*translate/)
    expect(shellCss).not.toMatch(/width:\s*100vw/)
  })

  it('does not change the default #root 1126px constraint used by non-dashboard screens', () => {
    expect(indexCss).toContain('#root {')
    expect(indexCss).toContain('width: 1126px')
    expect(loginCss).toContain('position: fixed')
    expect(loginCss).toContain('inset: 0')
    expect(loginTsx).toContain('login-page')
    expect(loginTsx).not.toContain('dashboard-shell')
  })

  it('keeps the RTL desktop sidebar as the first 272px grid column', () => {
    expect(shellCss).toContain('grid-template-columns: 272px minmax(0, 1fr)')
    expect(shellTsx).toContain('dashboard-shell__sidebar')
    expect(shellTsx).toContain('DashboardTopHeader')
  })

  it('makes header and main content fill the remaining desktop workspace', () => {
    expect(headerCss).toMatch(/\.dashboard-top-header\s*\{[^}]*width:\s*100%/s)
    expect(shellCss).toMatch(
      /@media \(min-width:\s*1025px\)[\s\S]*?\.dashboard-shell__content\s*\{[^}]*width:\s*100%/s,
    )
    expect(shellCss).toMatch(
      /@media \(min-width:\s*1025px\)[\s\S]*?\.teacher-dashboard[\s\S]*?max-width:\s*none/s,
    )
    expect(shellCss).toMatch(
      /@media \(min-width:\s*1025px\)[\s\S]*?\.manager-dashboard[\s\S]*?max-width:\s*none/s,
    )
    expect(shellCss).toMatch(
      /@media \(min-width:\s*1025px\)[\s\S]*?\.secretary-dashboard[\s\S]*?max-width:\s*none/s,
    )
    expect(shellCss).toMatch(
      /@media \(min-width:\s*1025px\)[\s\S]*?\.platform-admin-dashboard[\s\S]*?max-width:\s*none/s,
    )
  })

  it('preserves existing mobile/tablet shell breakpoints and drawer navigation', () => {
    expect(shellCss).toContain('@media (max-width: 1024px)')
    expect(shellCss).toContain('@media (max-width: 480px)')
    expect(shellTsx).toContain("'(max-width: 1024px)'")
    expect(shellTsx).toContain('dashboard-shell__mobile-nav-bar')
    expect(shellTsx).toContain('dashboard-shell__drawer')
  })

  it('does not alter teacher inactivity or installed-app login warning wiring', () => {
    const app = read('src/App.tsx')
    expect(app).toContain('useTeacherInactivityLogout')
    expect(app).toContain('TeacherInactivityWarningDialog')
    const login = read('src/pages/LoginPage.tsx')
    expect(login).toContain('isStandaloneDisplayMode()')
    expect(login).toContain('שימוש במחשב משותף')
  })
})
