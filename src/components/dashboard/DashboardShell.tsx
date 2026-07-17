import type { ReactNode } from 'react'
import type { AuthenticatedUserProfile } from '../../types/user'
import './DashboardShell.css'
import { DashboardTopHeader } from './DashboardTopHeader'
import type { DashboardNavItem } from './dashboardNav'

type DashboardShellProps = {
  roleLabel: string
  subtitle: string
  profile: AuthenticatedUserProfile
  navItems: DashboardNavItem[]
  activeSectionId: string
  onSectionSelect: (sectionId: string) => void
  onLogout: () => void
  children: ReactNode
}

export function DashboardShell({
  roleLabel,
  subtitle,
  profile,
  navItems,
  activeSectionId,
  onSectionSelect,
  onLogout,
  children,
}: DashboardShellProps) {
  return (
    <main dir="rtl" className={`dashboard-shell dashboard-shell--${profile.role}`}>
      <DashboardTopHeader
        roleSubtitle={roleLabel}
        userDisplayName={profile.fullName}
        role={profile.role}
        school={profile.school}
        onLogout={onLogout}
      />

      <div className="dashboard-shell__layout">
        <aside className="dashboard-shell__sidebar" aria-label={`ניווט ${roleLabel}`}>
          <header className="dashboard-shell__brand">
            <p className="dashboard-shell__subtitle">{subtitle}</p>
            {profile.school ? (
              <p className="dashboard-shell__school-name">{profile.school.name}</p>
            ) : null}
          </header>

          <nav className="dashboard-shell__nav" aria-label="ניווט חלקים בדף">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  item.id === activeSectionId
                    ? 'dashboard-shell__nav-item dashboard-shell__nav-item--active'
                    : 'dashboard-shell__nav-item'
                }
                onClick={() => {
                  if (item.onSelect) {
                    item.onSelect()
                    return
                  }

                  onSectionSelect(item.id)
                }}
                aria-current={item.id === activeSectionId ? 'true' : undefined}
                aria-label={item.ariaLabel ?? item.label}
                disabled={item.disabled}
              >
                <span
                  className={
                    item.badgeAnimate
                      ? 'dashboard-shell__nav-icon dashboard-shell__nav-icon--ringing'
                      : 'dashboard-shell__nav-icon'
                  }
                  aria-hidden="true"
                >
                  {item.icon}
                </span>
                <span className="dashboard-shell__nav-label">{item.label}</span>
                {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                  <span
                    className="dashboard-shell__nav-badge"
                    aria-label={`${item.badgeCount} תזכורות שלא נקראו`}
                  >
                    {item.badgeCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        <section className="dashboard-shell__content">{children}</section>
      </div>
    </main>
  )
}
