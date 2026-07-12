import { useEffect, useState } from 'react'
import { DashboardShell } from '../components/dashboard/DashboardShell'
import {
  NavArchiveIcon,
  NavInboxIcon,
  NavUsersIcon,
  type DashboardNavItem,
} from '../components/dashboard/dashboardNav'
import { SecretaryArchiveSection } from '../components/secretary/SecretaryArchiveSection'
import { SecretaryRequestsInbox } from '../components/secretary/SecretaryRequestsInbox'
import { SecretarySubstituteApprovalsSection } from '../components/secretary/SecretarySubstituteApprovalsSection'
import type { AuthenticatedUserProfile } from '../types/user'
import './SecretaryDashboardPage.css'

type SecretaryDashboardPageProps = {
  profile: AuthenticatedUserProfile
  onLogout: () => void
}

const secretaryNavItems: DashboardNavItem[] = [
  { id: 'substituteApprovals', label: 'אישורי מילויי מקום', icon: <NavUsersIcon /> },
  { id: 'requestsInbox', label: 'בקשות מורים', icon: <NavInboxIcon /> },
  { id: 'institutionalArchive', label: 'ארכיון מוסדי', icon: <NavArchiveIcon /> },
]

export function SecretaryDashboardPage({ profile, onLogout }: SecretaryDashboardPageProps) {
  const [activeSectionId, setActiveSectionId] = useState<string>('substituteApprovals')
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0)

  function handleSectionSelect(sectionId: string) {
    const target = document.querySelector<HTMLElement>(
      `.secretary-dashboard [data-section-id="${sectionId}"]`,
    )
    if (!target) {
      return
    }

    setActiveSectionId(sectionId)
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    requestAnimationFrame(() => target.focus({ preventScroll: true }))
  }

  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('.secretary-dashboard [data-section-id]'),
    )

    if (sections.length === 0) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter((entry) => entry.isIntersecting)
        if (visibleEntries.length === 0) {
          return
        }

        const mostVisible = visibleEntries.sort(
          (a, b) => b.intersectionRatio - a.intersectionRatio,
        )[0]
        const sectionId = mostVisible.target.getAttribute('data-section-id')
        if (sectionId) {
          setActiveSectionId(sectionId)
        }
      },
      { threshold: [0.3, 0.6], rootMargin: '-15% 0px -55% 0px' },
    )

    sections.forEach((section) => observer.observe(section))

    return () => observer.disconnect()
  }, [])

  function handleArchiveChanged() {
    setArchiveRefreshToken((value) => value + 1)
  }

  return (
    <DashboardShell
      roleLabel="אזור המזכירה"
      subtitle="ברוכה הבאה לאזור המזכירה ב־EduFlow."
      profile={profile}
      navItems={secretaryNavItems}
      activeSectionId={activeSectionId}
      onSectionSelect={handleSectionSelect}
      onLogout={onLogout}
    >
      <div dir="rtl" className="secretary-dashboard">
        <section
          id="secretary-substitute-approvals"
          data-section-id="substituteApprovals"
          className="secretary-dashboard__shell-section"
          tabIndex={-1}
        >
          <SecretarySubstituteApprovalsSection />
        </section>

        <section
          id="secretary-requests-inbox"
          data-section-id="requestsInbox"
          className="secretary-dashboard__shell-section"
          tabIndex={-1}
        >
          <SecretaryRequestsInbox onArchived={handleArchiveChanged} />
        </section>

        <section
          id="secretary-institutional-archive"
          data-section-id="institutionalArchive"
          className="secretary-dashboard__shell-section"
          tabIndex={-1}
        >
          <SecretaryArchiveSection refreshToken={archiveRefreshToken} />
        </section>
      </div>
    </DashboardShell>
  )
}
