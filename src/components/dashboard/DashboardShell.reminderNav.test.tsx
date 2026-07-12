import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardShell } from './DashboardShell'
import { NavBellIcon } from './dashboardNav'
import {
  REMINDER_BELL_NAV_ID,
  REMINDER_NAV_ARIA_LABEL,
  REMINDER_NAV_LABEL,
} from '../../utils/reminderNavigation'

const profile = {
  fullName: 'מזכירה',
  role: 'secretary' as const,
  school: { id: 'school-1', name: 'בית ספר', logoUrl: null, logoUpdatedAt: null },
}

afterEach(() => {
  cleanup()
})

describe('DashboardShell reminder bell navigation', () => {
  it('shows the reminder bell with badge and accessible label when unread reminders exist', () => {
    render(
      <DashboardShell
        roleLabel="אזור המזכירה"
        subtitle="ברוכה הבאה"
        profile={profile}
        navItems={[
          {
            id: REMINDER_BELL_NAV_ID,
            label: REMINDER_NAV_LABEL,
            icon: <NavBellIcon />,
            badgeCount: 2,
            badgeAnimate: true,
            ariaLabel: REMINDER_NAV_ARIA_LABEL,
            onSelect: vi.fn(),
          },
          { id: 'requestsInbox', label: 'בקשות מורים', icon: <NavBellIcon /> },
        ]}
        activeSectionId="requestsInbox"
        onSectionSelect={vi.fn()}
        onLogout={vi.fn()}
      >
        <div />
      </DashboardShell>,
    )

    expect(screen.getByRole('button', { name: REMINDER_NAV_ARIA_LABEL })).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('invokes custom bell navigation instead of section scrolling', async () => {
    const user = userEvent.setup()
    const onBellSelect = vi.fn()
    const onSectionSelect = vi.fn()

    render(
      <DashboardShell
        roleLabel="אזור המזכירה"
        subtitle="ברוכה הבאה"
        profile={profile}
        navItems={[
          {
            id: REMINDER_BELL_NAV_ID,
            label: REMINDER_NAV_LABEL,
            icon: <NavBellIcon />,
            badgeCount: 1,
            ariaLabel: REMINDER_NAV_ARIA_LABEL,
            onSelect: onBellSelect,
          },
          { id: 'requestsInbox', label: 'בקשות מורים', icon: <NavBellIcon /> },
        ]}
        activeSectionId="requestsInbox"
        onSectionSelect={onSectionSelect}
        onLogout={vi.fn()}
      >
        <div />
      </DashboardShell>,
    )

    await user.click(screen.getByRole('button', { name: REMINDER_NAV_ARIA_LABEL }))

    expect(onBellSelect).toHaveBeenCalledTimes(1)
    expect(onSectionSelect).not.toHaveBeenCalled()
  })
})
