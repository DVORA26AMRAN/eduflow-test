import { useMemo, useState } from 'react'
import { DashboardShell } from '../components/dashboard/DashboardShell'
import { DashboardSectionPanel } from '../components/dashboard/DashboardSectionPanel'
import { NavClipboardIcon, NavInboxIcon, type DashboardNavItem } from '../components/dashboard/dashboardNav'
import { PlatformAdminSchoolsSection } from '../components/platform/PlatformAdminSchoolsSection'
import { PlatformAdminRegistrationsSection } from '../components/platform/PlatformAdminRegistrationsSection'
import {
  PLATFORM_ADMIN_SCHOOLS_NAV_LABEL,
  PLATFORM_ADMIN_SCHOOLS_SECTION_ID,
} from '../types/institutionAdmin'
import {
  PLATFORM_ADMIN_REGISTRATIONS_NAV_LABEL,
  PLATFORM_ADMIN_REGISTRATIONS_SECTION_ID,
} from '../types/schoolRegistration'
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
      {
        id: PLATFORM_ADMIN_REGISTRATIONS_SECTION_ID,
        label: PLATFORM_ADMIN_REGISTRATIONS_NAV_LABEL,
        icon: <NavInboxIcon />,
      },
    ],
    [],
  )

  return (
    <DashboardShell
      roleLabel="אזור מנהל/ת מערכת"
      subtitle="ניהול בתי ספר, לוגואים והרשמות"
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
        <DashboardSectionPanel
          id="platform-admin-registrations"
          sectionId={PLATFORM_ADMIN_REGISTRATIONS_SECTION_ID}
          activeSectionId={activeSectionId}
          className="platform-admin-dashboard__section"
        >
          <PlatformAdminRegistrationsSection />
        </DashboardSectionPanel>
      </div>
    </DashboardShell>
  )
}
