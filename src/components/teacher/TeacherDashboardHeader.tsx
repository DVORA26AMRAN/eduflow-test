import { DashboardTopHeader } from '../dashboard/DashboardTopHeader'

type TeacherDashboardHeaderProps = {
  onLogout: () => void
}

export function TeacherDashboardHeader({ onLogout }: TeacherDashboardHeaderProps) {
  return (
    <DashboardTopHeader
      welcomeMessage="ברוכה הבאה"
      roleSubtitle="אזור המורה"
      userDisplayName="משתמש/ת מחובר/ת"
      onLogout={onLogout}
      showSearch
    />
  )
}
