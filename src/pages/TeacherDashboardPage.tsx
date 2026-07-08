import { useEffect, useState } from 'react'
import organizationLogo from '../assets/images/logo.png.png'
import { DashboardShell } from '../components/dashboard/DashboardShell'
import {
  NavBellIcon,
  NavClipboardIcon,
  NavUsersIcon,
  type DashboardNavItem,
} from '../components/dashboard/dashboardNav'
import { TeacherNotificationsSection } from '../components/teacher/TeacherNotificationsSection'
import { TeacherRequestsSection } from '../components/teacher/TeacherRequestsSection'
import { TeacherSubstituteBoardSection } from '../components/teacher/TeacherSubstituteBoardSection'
import './TeacherDashboardPage.css'

type TeacherDashboardPageProps = {
  onLogout: () => void
}

const teacherNavItems: DashboardNavItem[] = [
  { id: 'notifications', label: 'התראות', icon: <NavBellIcon /> },
  { id: 'requests', label: 'בקשות', icon: <NavClipboardIcon /> },
  { id: 'substituteBoard', label: 'לוח מילויי מקום', icon: <NavUsersIcon /> },
]

export function TeacherDashboardPage({ onLogout }: TeacherDashboardPageProps) {
  const [activeSectionId, setActiveSectionId] = useState<string>('notifications')

  function handleSectionSelect(sectionId: string) {
    const target = document.querySelector<HTMLElement>(
      `.teacher-dashboard [data-section-id="${sectionId}"]`,
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
      document.querySelectorAll<HTMLElement>('.teacher-dashboard [data-section-id]'),
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

  return (
    <DashboardShell
      roleLabel="אזור המורה"
      subtitle="ברוכה הבאה לאזור המורה ב־EduFlow."
      logoSrc={organizationLogo}
      navItems={teacherNavItems}
      activeSectionId={activeSectionId}
      onSectionSelect={handleSectionSelect}
      onLogout={onLogout}
    >
      <div dir="rtl" className="teacher-dashboard">
        <section
          id="teacher-notifications"
          data-section-id="notifications"
          className="teacher-dashboard__shell-section"
          tabIndex={-1}
        >
          <TeacherNotificationsSection />
        </section>

        <section
          id="teacher-requests"
          data-section-id="requests"
          className="teacher-dashboard__shell-section"
          tabIndex={-1}
        >
          <TeacherRequestsSection />
        </section>

        <section
          id="teacher-substitute-board"
          data-section-id="substituteBoard"
          className="teacher-dashboard__shell-section"
          tabIndex={-1}
        >
          <TeacherSubstituteBoardSection />
        </section>
      </div>
    </DashboardShell>
  )
}
