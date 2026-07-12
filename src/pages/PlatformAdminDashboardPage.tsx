import { DashboardShell } from '../components/dashboard/DashboardShell'
import { PlatformAdminLogoSection } from '../components/platform/PlatformAdminLogoSection'
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
  return (
    <DashboardShell
      roleLabel="אזור מנהל/ת מערכת"
      subtitle="ניהול לוגואים לבתי ספר"
      profile={profile}
      navItems={[]}
      activeSectionId="logos"
      onSectionSelect={() => undefined}
      onLogout={onLogout}
    >
      <div dir="rtl" className="platform-admin-dashboard">
        <PlatformAdminLogoSection />
      </div>
    </DashboardShell>
  )
}
