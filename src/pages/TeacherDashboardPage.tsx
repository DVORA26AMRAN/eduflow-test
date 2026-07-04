import { TeacherDashboardHeader } from '../components/teacher/TeacherDashboardHeader'
import { TeacherNotificationsSection } from '../components/teacher/TeacherNotificationsSection'
import { TeacherRequestsSection } from '../components/teacher/TeacherRequestsSection'
import { TeacherSubstituteBoardSection } from '../components/teacher/TeacherSubstituteBoardSection'
import './TeacherDashboardPage.css'

type TeacherDashboardPageProps = {
  onLogout: () => void
}

export function TeacherDashboardPage({ onLogout }: TeacherDashboardPageProps) {
  return (
    <main dir="rtl" className="teacher-dashboard">
      <TeacherDashboardHeader onLogout={onLogout} />
      <TeacherNotificationsSection />
      <TeacherRequestsSection />
      <TeacherSubstituteBoardSection />
    </main>
  )
}
