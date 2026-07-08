import { DashboardTopHeader } from '../dashboard/DashboardTopHeader'

type ManagerDashboardHeaderProps = {
  onLogout: () => void
}

export function ManagerDashboardHeader({ onLogout }: ManagerDashboardHeaderProps) {
  return (
    <DashboardTopHeader
      welcomeMessage="ברוכה הבאה"
      roleSubtitle="אזור מנהלת"
      userDisplayName="משתמש/ת מחובר/ת"
      onLogout={onLogout}
      showSearch
    />
  )
}
