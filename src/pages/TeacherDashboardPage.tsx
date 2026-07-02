import { TeacherDashboardHeader } from '../components/teacher/TeacherDashboardHeader'
import { TeacherRequestsSection } from '../components/teacher/TeacherRequestsSection'
import './TeacherDashboardPage.css'

type TeacherDashboardPageProps = {
  onLogout: () => void
}

export function TeacherDashboardPage({ onLogout }: TeacherDashboardPageProps) {
  return (
    <main dir="rtl" className="teacher-dashboard">
      <TeacherDashboardHeader onLogout={onLogout} />
      <TeacherRequestsSection />
    </main>
  )
}
