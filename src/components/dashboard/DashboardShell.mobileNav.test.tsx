import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBodyScrollLockForTests } from '../../utils/bodyScrollLock'
import { DashboardShell } from './DashboardShell'
import {
  NavArchiveIcon,
  NavBellIcon,
  NavCalendarIcon,
  NavChartIcon,
  NavClipboardIcon,
  NavInboxIcon,
  NavUsersIcon,
  type DashboardNavItem,
} from './dashboardNav'

const teacherProfile = {
  fullName: 'מורה',
  role: 'teacher' as const,
  school: {
    id: 'school-1',
    name: 'בית ספר',
    timeZone: 'Asia/Jerusalem',
    logoUrl: null,
    logoUpdatedAt: null,
  },
}

const secretaryProfile = {
  ...teacherProfile,
  fullName: 'מזכירה',
  role: 'secretary' as const,
}

const managerProfile = {
  ...teacherProfile,
  fullName: 'מנהלת',
  role: 'institution_manager' as const,
}

const teacherNavItems: DashboardNavItem[] = [
  { id: 'overview', label: 'סקירה כללית', icon: <NavChartIcon /> },
  { id: 'notifications', label: 'התראות', icon: <NavBellIcon /> },
  { id: 'requests', label: 'בקשות', icon: <NavClipboardIcon /> },
  { id: 'substituteBoard', label: 'לוח מילויי מקום', icon: <NavUsersIcon /> },
  { id: 'archive', label: 'ארכיון', icon: <NavArchiveIcon /> },
  { id: 'meetingCalendar', label: 'יומן פגישות', icon: <NavCalendarIcon /> },
]

const secretaryNavItems: DashboardNavItem[] = [
  { id: 'overview', label: 'סקירה כללית', icon: <NavChartIcon /> },
  { id: 'requestsInbox', label: 'בקשות מורים', icon: <NavInboxIcon /> },
  { id: 'institutionalArchive', label: 'ארכיון מוסדי', icon: <NavArchiveIcon /> },
]

const managerNavItems: DashboardNavItem[] = [
  { id: 'overview', label: 'סקירה כללית', icon: <NavChartIcon /> },
  { id: 'teacherRequests', label: 'בקשות מורים', icon: <NavInboxIcon /> },
  { id: 'archive', label: 'הארכיון שלי', icon: <NavArchiveIcon /> },
  { id: 'team', label: 'ניהול משתמשים', icon: <NavUsersIcon /> },
]

function mockViewport(isMobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: isMobile && query.includes('max-width: 1024px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

beforeEach(() => {
  mockViewport(true)
})

afterEach(() => {
  cleanup()
  resetBodyScrollLockForTests()
  mockViewport(false)
})

async function openMobileMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'תפריט ניווט' }))
  return screen.getByRole('dialog', { name: 'תפריט ניווט' })
}

describe('DashboardShell mobile navigation drawer', () => {
  it('renders the mobile menu button and current section label', () => {
    render(
      <DashboardShell
        roleLabel="אזור המורה"
        subtitle="ברוכה הבאה"
        profile={teacherProfile}
        navItems={teacherNavItems}
        activeSectionId="archive"
        onSectionSelect={vi.fn()}
        onLogout={vi.fn()}
      >
        <div>תוכן</div>
      </DashboardShell>,
    )

    expect(screen.getByRole('button', { name: 'תפריט ניווט' })).toBeInTheDocument()
    expect(
      document.querySelector('.dashboard-shell__mobile-section-label'),
    ).toHaveTextContent('ארכיון')
    expect(screen.getByRole('button', { name: 'תפריט ניווט' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText('ניווט חלקים בדף')).not.toBeInTheDocument()
  })

  it('keeps the desktop sidebar navigation unchanged on desktop width', () => {
    mockViewport(false)

    render(
      <DashboardShell
        roleLabel="אזור המורה"
        subtitle="ברוכה הבאה"
        profile={teacherProfile}
        navItems={teacherNavItems}
        activeSectionId="overview"
        onSectionSelect={vi.fn()}
        onLogout={vi.fn()}
      >
        <div />
      </DashboardShell>,
    )

    expect(screen.queryByRole('button', { name: 'תפריט ניווט' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('ניווט אזור המורה')).toBeInTheDocument()
    expect(
      within(screen.getByLabelText('ניווט חלקים בדף')).getByRole('button', {
        name: 'סקירה כללית',
      }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('opens a vertical drawer with all supplied nav items and highlights the active one', async () => {
    const user = userEvent.setup()
    render(
      <DashboardShell
        roleLabel="אזור המורה"
        subtitle="ברוכה הבאה"
        profile={teacherProfile}
        navItems={teacherNavItems}
        activeSectionId="requests"
        onSectionSelect={vi.fn()}
        onLogout={vi.fn()}
      >
        <div />
      </DashboardShell>,
    )

    const drawer = await openMobileMenu(user)
    const menuButton = screen.getByRole('button', { name: 'תפריט ניווט' })

    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    expect(drawer.className).toContain('dashboard-shell__drawer')

    for (const item of teacherNavItems) {
      expect(within(drawer).getByRole('button', { name: item.label })).toBeInTheDocument()
    }

    expect(within(drawer).getByRole('button', { name: 'בקשות' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(drawer).queryAllByRole('button', { name: 'ארכיון' })).toHaveLength(1)
  })

  it('activates a section and closes the drawer after selection', async () => {
    const user = userEvent.setup()
    const onSectionSelect = vi.fn()

    render(
      <DashboardShell
        roleLabel="אזור המורה"
        subtitle="ברוכה הבאה"
        profile={teacherProfile}
        navItems={teacherNavItems}
        activeSectionId="overview"
        onSectionSelect={onSectionSelect}
        onLogout={vi.fn()}
      >
        <div data-testid="content">תוכן</div>
      </DashboardShell>,
    )

    const drawer = await openMobileMenu(user)
    await user.click(within(drawer).getByRole('button', { name: 'ארכיון' }))

    expect(onSectionSelect).toHaveBeenCalledWith('archive')
    expect(screen.queryByRole('dialog', { name: 'תפריט ניווט' })).not.toBeInTheDocument()
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('closes the drawer when the backdrop is pressed', async () => {
    const user = userEvent.setup()
    render(
      <DashboardShell
        roleLabel="אזור המורה"
        subtitle="ברוכה הבאה"
        profile={teacherProfile}
        navItems={teacherNavItems}
        activeSectionId="overview"
        onSectionSelect={vi.fn()}
        onLogout={vi.fn()}
      >
        <div />
      </DashboardShell>,
    )

    await openMobileMenu(user)
    const backdrop = document.querySelector('.dashboard-shell__drawer-backdrop')
    expect(backdrop).toBeTruthy()
    await user.click(backdrop!)

    expect(screen.queryByRole('dialog', { name: 'תפריט ניווט' })).not.toBeInTheDocument()
  })

  it('closes the drawer when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(
      <DashboardShell
        roleLabel="אזור המורה"
        subtitle="ברוכה הבאה"
        profile={teacherProfile}
        navItems={teacherNavItems}
        activeSectionId="overview"
        onSectionSelect={vi.fn()}
        onLogout={vi.fn()}
      >
        <div />
      </DashboardShell>,
    )

    await openMobileMenu(user)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'תפריט ניווט' })).not.toBeInTheDocument()
  })

  it('passes Teacher navigation items into the drawer', async () => {
    const user = userEvent.setup()
    render(
      <DashboardShell
        roleLabel="אזור המורה"
        subtitle="ברוכה הבאה"
        profile={teacherProfile}
        navItems={teacherNavItems}
        activeSectionId="overview"
        onSectionSelect={vi.fn()}
        onLogout={vi.fn()}
      >
        <div />
      </DashboardShell>,
    )

    const drawer = await openMobileMenu(user)
    expect(within(drawer).getByRole('button', { name: 'לוח מילויי מקום' })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'ארכיון' })).toBeInTheDocument()
    expect(
      within(drawer).queryByRole('button', { name: 'ארכיון מוסדי' }),
    ).not.toBeInTheDocument()
  })

  it('passes Secretary navigation items into the drawer', async () => {
    const user = userEvent.setup()
    render(
      <DashboardShell
        roleLabel="אזור המזכירה"
        subtitle="ברוכה הבאה"
        profile={secretaryProfile}
        navItems={secretaryNavItems}
        activeSectionId="overview"
        onSectionSelect={vi.fn()}
        onLogout={vi.fn()}
      >
        <div />
      </DashboardShell>,
    )

    const drawer = await openMobileMenu(user)
    expect(within(drawer).getByRole('button', { name: 'בקשות מורים' })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'ארכיון מוסדי' })).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'ניהול משתמשים' })).not.toBeInTheDocument()
  })

  it('passes Manager navigation items into the drawer', async () => {
    const user = userEvent.setup()
    render(
      <DashboardShell
        roleLabel="אזור המנהלת"
        subtitle="ברוכה הבאה"
        profile={managerProfile}
        navItems={managerNavItems}
        activeSectionId="overview"
        onSectionSelect={vi.fn()}
        onLogout={vi.fn()}
      >
        <div />
      </DashboardShell>,
    )

    const drawer = await openMobileMenu(user)
    expect(within(drawer).getByRole('button', { name: 'הארכיון שלי' })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'ניהול משתמשים' })).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'ארכיון מוסדי' })).not.toBeInTheDocument()
  })
})

describe('DashboardShell mobile nav CSS contract', () => {
  it('removes horizontal mobile-nav scrolling and keeps desktop sidebar width', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/dashboard/DashboardShell.css'),
      'utf8',
    )

    expect(css).toContain('grid-template-columns: 272px minmax(0, 1fr)')
    expect(css).toContain('.dashboard-shell__mobile-nav-bar')
    expect(css).toContain('.dashboard-shell__drawer')
    expect(css).toContain('inset-inline-start')
    expect(css).not.toMatch(
      /\.dashboard-shell__nav\s*\{[^}]*overflow-x:\s*auto/s,
    )
    expect(css).not.toContain('scrollbar-width: none')
    expect(css).toContain('dashboard-shell--mobile-nav')
  })
})
