import { useMemo, useState } from 'react'
import { DashboardShell } from '../components/dashboard/DashboardShell'
import { DashboardSectionPanel } from '../components/dashboard/DashboardSectionPanel'
import { NavClipboardIcon, type DashboardNavItem } from '../components/dashboard/dashboardNav'
import { PlatformAdminSchoolsSection } from '../components/platform/PlatformAdminSchoolsSection'
import {
  PLATFORM_ADMIN_SCHOOLS_NAV_LABEL,
  PLATFORM_ADMIN_SCHOOLS_SECTION_ID,
} from '../types/institutionAdmin'
import type { AuthenticatedUserProfile } from '../types/user'
import './PlatformAdminDashboardPage.css'

type PlatformAdminDashboardPageProps = {
  profile: AuthenticatedUserProfile
  onLogout: () => void
}

export function PlatformAdminDashboardPage({
  profile,
  onLogout,
}: PlatformAdminDashboardPageProps) {
  const [activeSectionId, setActiveSectionId] = useState(PLATFORM_ADMIN_SCHOOLS_SECTION_ID)

  const navItems: DashboardNavItem[] = useMemo(
    () => [
      {
        id: PLATFORM_ADMIN_SCHOOLS_SECTION_ID,
        label: PLATFORM_ADMIN_SCHOOLS_NAV_LABEL,
        icon: <NavClipboardIcon />,
      },
    ],
    [],
  )

  return (
    <DashboardShell
      roleLabel="אזור מנהל/ת מערכת"
      subtitle="ניהול בתי ספר ולוגואים"
      profile={profile}
      navItems={navItems}
      activeSectionId={activeSectionId}
      onSectionSelect={setActiveSectionId}
      onLogout={onLogout}
    >
      <div dir="rtl" className="platform-admin-dashboard">
        <DashboardSectionPanel
          id="platform-admin-schools"
          sectionId={PLATFORM_ADMIN_SCHOOLS_SECTION_ID}
          activeSectionId={activeSectionId}
          className="platform-admin-dashboard__section"
        >
          <PlatformAdminSchoolsSection />
        </DashboardSectionPanel>
      </div>
    </DashboardShell>
  )
}
