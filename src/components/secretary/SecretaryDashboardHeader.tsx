import { DashboardTopHeader } from '../dashboard/DashboardTopHeader'

type SecretaryDashboardHeaderProps = {
  onLogout: () => void
}

export function SecretaryDashboardHeader({ onLogout }: SecretaryDashboardHeaderProps) {
  return (
    <DashboardTopHeader
      welcomeMessage="ברוכה הבאה"
      roleSubtitle="אזור המזכירה"
      userDisplayName="משתמש/ת מחובר/ת"
      onLogout={onLogout}
      showSearch
    />
  )
}
