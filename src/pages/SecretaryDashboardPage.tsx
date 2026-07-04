import { SecretaryDashboardHeader } from '../components/secretary/SecretaryDashboardHeader'
import { SecretaryRequestsInbox } from '../components/secretary/SecretaryRequestsInbox'
import { SecretarySubstituteApprovalsSection } from '../components/secretary/SecretarySubstituteApprovalsSection'
import './SecretaryDashboardPage.css'

type SecretaryDashboardPageProps = {
  onLogout: () => void
}

export function SecretaryDashboardPage({ onLogout }: SecretaryDashboardPageProps) {
  return (
    <main dir="rtl" className="secretary-dashboard">
      <SecretaryDashboardHeader onLogout={onLogout} />
      <SecretarySubstituteApprovalsSection />
      <SecretaryRequestsInbox />
    </main>
  )
}
