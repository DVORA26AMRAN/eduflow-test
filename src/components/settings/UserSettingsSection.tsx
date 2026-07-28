import { GoogleIntegrationSection } from './GoogleIntegrationSection'
import { DashboardSection } from '../dashboard/DashboardSection'
import { NavSettingsIcon } from '../dashboard/dashboardNav'

type UserSettingsSectionProps = {
  initialGoogleReturnMessage?: string | null
}

export function UserSettingsSection({
  initialGoogleReturnMessage = null,
}: UserSettingsSectionProps) {
  return (
    <div className="user-settings" dir="rtl">
      <section className="ds-card user-settings__intro">
        <DashboardSection
          title="הגדרות משתמש"
          icon={<NavSettingsIcon />}
          className="dashboard-section--flush-header"
        >
          <p className="ds-helper-text">
            הגדרות אישיות לחשבון Adoflow. אינטגרציות חיצוניות מופיעות למטה.
          </p>
        </DashboardSection>
      </section>

      <GoogleIntegrationSection initialReturnMessage={initialGoogleReturnMessage} />
    </div>
  )
}
