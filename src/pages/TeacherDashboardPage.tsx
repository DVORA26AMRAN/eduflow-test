import { useCallback, useEffect, useState } from 'react'

import { DashboardShell } from '../components/dashboard/DashboardShell'

import { DashboardSectionPanel } from '../components/dashboard/DashboardSectionPanel'

import {

  NavArchiveIcon,

  NavBellIcon,

  NavChartIcon,

  NavClipboardIcon,

  NavUsersIcon,

  type DashboardNavItem,

} from '../components/dashboard/dashboardNav'

import { useDashboardSectionNavigation } from '../hooks/useDashboardSectionNavigation'
import { useUnreadRequestMessageNotifications } from '../hooks/useUnreadRequestMessageNotifications'

import { TeacherAnalyticsSection } from '../components/teacher/TeacherAnalyticsSection'

import { TeacherArchiveSection } from '../components/teacher/TeacherArchiveSection'

import { TeacherNotificationsSection } from '../components/teacher/TeacherNotificationsSection'

import { TeacherRequestsSection } from '../components/teacher/TeacherRequestsSection'

import { TeacherSubstituteBoardSection } from '../components/teacher/TeacherSubstituteBoardSection'

import { loadTeacherRequestReminderStates } from '../services/requestReminders'

import {

  DASHBOARD_OVERVIEW_SECTION_ID,

  type DashboardRequestNavigationIntent,

} from '../types/dashboardAnalytics'

import type { TeacherRequestReminderState } from '../types/requestReminder'

import type { AuthenticatedUserProfile } from '../types/user'

import './TeacherDashboardPage.css'



type TeacherDashboardPageProps = {

  profile: AuthenticatedUserProfile

  onLogout: () => void

}



const teacherNavItems: DashboardNavItem[] = [

  { id: DASHBOARD_OVERVIEW_SECTION_ID, label: 'סקירה כללית', icon: <NavChartIcon /> },

  { id: 'notifications', label: 'התראות', icon: <NavBellIcon /> },

  { id: 'requests', label: 'בקשות', icon: <NavClipboardIcon /> },

  { id: 'substituteBoard', label: 'לוח מילויי מקום', icon: <NavUsersIcon /> },

  { id: 'archive', label: 'הארכיון שלי', icon: <NavArchiveIcon /> },

]



export function TeacherDashboardPage({ profile, onLogout }: TeacherDashboardPageProps) {

  const [activeSectionId, setActiveSectionId] = useState<string>(DASHBOARD_OVERVIEW_SECTION_ID)

  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0)

  const [analyticsRefreshToken, setAnalyticsRefreshToken] = useState(0)

  const [requestNavigationIntent, setRequestNavigationIntent] =

    useState<DashboardRequestNavigationIntent | null>(null)

  const [reminderStatesByRequestId, setReminderStatesByRequestId] = useState<

    Map<string, TeacherRequestReminderState>

  >(new Map())



  const showSection = useDashboardSectionNavigation(setActiveSectionId)

  const {
    unreadMessageRequestIds,
    requestIdsWithMessages,
    markConversationAsRead,
    registerRequestHasMessages,
  } = useUnreadRequestMessageNotifications()

  const handleConversationOpened = useCallback(
    async (requestId: string) => {
      registerRequestHasMessages(requestId)
      return markConversationAsRead(requestId)
    },
    [markConversationAsRead, registerRequestHasMessages],
  )



  function handleNavigateToRequests(intent: DashboardRequestNavigationIntent) {

    setRequestNavigationIntent(intent)

    showSection('requests')

  }



  useEffect(() => {

    let isCancelled = false



    async function fetchReminderStates() {

      const result = await loadTeacherRequestReminderStates()

      if (isCancelled || !result.ok) {

        return

      }



      setReminderStatesByRequestId(

        new Map(result.states.map((state) => [state.request_id, state])),

      )

    }



    void fetchReminderStates()



    return () => {

      isCancelled = true

    }

  }, [archiveRefreshToken, analyticsRefreshToken])



  function handleArchiveChanged() {

    setArchiveRefreshToken((value) => value + 1)

    setAnalyticsRefreshToken((value) => value + 1)

  }



  return (

    <DashboardShell

      roleLabel="אזור המורה"

      subtitle="ברוכה הבאה לאזור המורה ב־EduFlow."

      profile={profile}

      navItems={teacherNavItems}

      activeSectionId={activeSectionId}

      onSectionSelect={showSection}

      onLogout={onLogout}

    >

      <div dir="rtl" className="teacher-dashboard">

        <DashboardSectionPanel

          id="teacher-overview"

          sectionId={DASHBOARD_OVERVIEW_SECTION_ID}

          activeSectionId={activeSectionId}

          className="teacher-dashboard__shell-section"

        >

          <TeacherAnalyticsSection

            refreshToken={analyticsRefreshToken + archiveRefreshToken}

            reminderStatesByRequestId={reminderStatesByRequestId}

            onNavigateToRequests={handleNavigateToRequests}

            onReminderSent={() => setAnalyticsRefreshToken((value) => value + 1)}

          />

        </DashboardSectionPanel>



        <DashboardSectionPanel

          id="teacher-notifications"

          sectionId="notifications"

          activeSectionId={activeSectionId}

          className="teacher-dashboard__shell-section"

        >

          <TeacherNotificationsSection />

        </DashboardSectionPanel>



        <DashboardSectionPanel

          id="teacher-requests"

          sectionId="requests"

          activeSectionId={activeSectionId}

          className="teacher-dashboard__shell-section"

        >

          <TeacherRequestsSection

            refreshToken={archiveRefreshToken}

            onArchived={handleArchiveChanged}

            unreadMessageRequestIds={unreadMessageRequestIds}
            requestIdsWithMessages={requestIdsWithMessages}
            onConversationOpened={handleConversationOpened}

            requestNavigationIntent={requestNavigationIntent}

            onRequestNavigationIntentConsumed={() => setRequestNavigationIntent(null)}

          />

        </DashboardSectionPanel>



        <DashboardSectionPanel

          id="teacher-substitute-board"

          sectionId="substituteBoard"

          activeSectionId={activeSectionId}

          className="teacher-dashboard__shell-section"

        >

          <TeacherSubstituteBoardSection />

        </DashboardSectionPanel>



        <DashboardSectionPanel

          id="teacher-archive"

          sectionId="archive"

          activeSectionId={activeSectionId}

          className="teacher-dashboard__shell-section"

        >

          <TeacherArchiveSection
            refreshToken={archiveRefreshToken}
            unreadMessageRequestIds={unreadMessageRequestIds}
            requestIdsWithMessages={requestIdsWithMessages}
            onConversationOpened={handleConversationOpened}
          />

        </DashboardSectionPanel>

      </div>

    </DashboardShell>

  )

}


