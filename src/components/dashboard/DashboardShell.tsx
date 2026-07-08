import type { ReactNode } from 'react'
import './DashboardShell.css'
import { DashboardTopHeader } from './DashboardTopHeader'
import type { DashboardNavItem } from './dashboardNav'

type DashboardShellProps = {
  roleLabel: string
  subtitle: string
  logoSrc: string
  navItems: DashboardNavItem[]
  activeSectionId: string
  onSectionSelect: (sectionId: string) => void
  onLogout: () => void
  children: ReactNode
}

export function DashboardShell({
  roleLabel,
  subtitle,
  logoSrc,
  navItems,
  activeSectionId,
  onSectionSelect,
  onLogout,
  children,
}: DashboardShellProps) {
  return (
    <main dir="rtl" className="dashboard-shell">
      <section className="dashboard-shell__content">
        <DashboardTopHeader
          welcomeMessage="ברוכה הבאה"
          roleSubtitle={roleLabel}
          userDisplayName="משתמש/ת מחובר/ת"
          onLogout={onLogout}
          showSearch
        />
        {children}
      </section>

      <aside className="dashboard-shell__sidebar" aria-label={`ניווט ${roleLabel}`}>
        <header className="dashboard-shell__brand">
          <img className="dashboard-shell__logo" src={logoSrc} alt="לוגו הארגון" />
          <p className="dashboard-shell__subtitle">{subtitle}</p>
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
              onClick={() => onSectionSelect(item.id)}
              aria-current={item.id === activeSectionId ? 'true' : undefined}
            >
              <span className="dashboard-shell__nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="dashboard-shell__nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

      </aside>
    </main>
  )
}
