import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DashboardShell } from '../components/dashboard/DashboardShell'
import { DashboardSectionPanel } from '../components/dashboard/DashboardSectionPanel'

import {
  NavArchiveIcon,
  NavBellIcon,
  NavCalendarIcon,
  NavChartIcon,
  NavClipboardIcon,
  NavInboxIcon,
  NavUsersIcon,
  type DashboardNavItem,
} from '../components/dashboard/dashboardNav'

import { MeetingCalendarSection } from '../components/meetingCalendar/MeetingCalendarSection'
import { SecretaryAnalyticsSection } from '../components/secretary/SecretaryAnalyticsSection'
import { SecretaryArchiveSection } from '../components/secretary/SecretaryArchiveSection'
import { SecretaryRequestsInbox } from '../components/secretary/SecretaryRequestsInbox'
import { SecretarySubstituteApprovalsSection } from '../components/secretary/SecretarySubstituteApprovalsSection'
import { StaffDirectoryPage } from './StaffDirectoryPage'
import { useAdminReminderNotifications } from '../hooks/useAdminReminderNotifications'
import { useUnreadRequestMessageNotifications } from '../hooks/useUnreadRequestMessageNotifications'
import { useDashboardSectionNavigation } from '../hooks/useDashboardSectionNavigation'
import { useReminderBellNavigation } from '../hooks/useReminderBellNavigation'
import { loadInstitutionRequestReminderSummaries } from '../services/requestReminders'
import { resolveSecretaryReminderRequestLocation } from '../services/reminderRequestLocation'
import {
  DASHBOARD_OVERVIEW_SECTION_ID,
  type DashboardRequestNavigationIntent,
} from '../types/dashboardAnalytics'
import type { RequestReminderSummary } from '../types/requestReminder'
import {
  REMINDER_BELL_NAV_ID,
  REMINDER_NAV_ARIA_LABEL,
  REMINDER_NAV_LABEL,
} from '../utils/reminderNavigation'
import type { AuthenticatedUserProfile } from '../types/user'
import { MEETING_CALENDAR_NAV_LABEL, MEETING_CALENDAR_SECTION_ID } from '../utils/meetingCalendarDisplay'
import {
  STAFF_DIRECTORY_NAV_LABEL,
  STAFF_DIRECTORY_SECTION_ID,
} from '../utils/staffDirectoryDisplay'

import './SecretaryDashboardPage.css'

type SecretaryDashboardPageProps = {
  profile: AuthenticatedUserProfile
  onLogout: () => void
}

export function SecretaryDashboardPage({ profile, onLogout }: SecretaryDashboardPageProps) {
  const [activeSectionId, setActiveSectionId] = useState<string>(DASHBOARD_OVERVIEW_SECTION_ID)
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0)
  const [analyticsRefreshToken, setAnalyticsRefreshToken] = useState(0)
  const [requestNavigationIntent, setRequestNavigationIntent] =
    useState<DashboardRequestNavigationIntent | null>(null)
  const [reminderSummariesByRequestId, setReminderSummariesByRequestId] = useState<
    Map<string, RequestReminderSummary>
  >(new Map())
  const [liveAnnouncement, setLiveAnnouncement] = useState('')
  const announcementTimeoutRef = useRef<number | null>(null)

  const showSection = useDashboardSectionNavigation(setActiveSectionId)

  const {
    unreadCount,
    unreadReminderRequestIds,
    getNewestUnreadReminder,
    markReminderNotificationAsRead,
  } = useAdminReminderNotifications()

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

  const announceNavigation = useCallback((message: string) => {
    setLiveAnnouncement(message)

    if (announcementTimeoutRef.current !== null) {
      window.clearTimeout(announcementTimeoutRef.current)
    }

    announcementTimeoutRef.current = window.setTimeout(() => {
      setLiveAnnouncement('')
      announcementTimeoutRef.current = null
    }, 3000)
  }, [])

  const {
    navigationIntent,
    highlightedRequestId,
    handleReminderBellClick,
    handleReminderNavigationComplete,
  } = useReminderBellNavigation({
    role: 'secretary',
    scrollToSection: showSection,
    resolveLocation: resolveSecretaryReminderRequestLocation,
    getNewestUnreadReminder,
    markReminderNotificationAsRead,
    onNavigationAnnouncement: announceNavigation,
  })

  const secretaryNavItems: DashboardNavItem[] = useMemo(() => {
    const items: DashboardNavItem[] = [
      { id: DASHBOARD_OVERVIEW_SECTION_ID, label: 'סקירה כללית', icon: <NavChartIcon /> },
    ]

    if (unreadCount > 0) {
      items.push({
        id: REMINDER_BELL_NAV_ID,
        label: REMINDER_NAV_LABEL,
        icon: <NavBellIcon />,
        badgeCount: unreadCount,
        badgeAnimate: true,
        ariaLabel: REMINDER_NAV_ARIA_LABEL,
        onSelect: () => {
          void handleReminderBellClick()
        },
      })
    }

    items.push(
      { id: 'substituteApprovals', label: 'אישורי מילויי מקום', icon: <NavUsersIcon /> },
      { id: 'requestsInbox', label: 'בקשות מורים', icon: <NavInboxIcon /> },
      { id: MEETING_CALENDAR_SECTION_ID, label: MEETING_CALENDAR_NAV_LABEL, icon: <NavCalendarIcon /> },
      { id: STAFF_DIRECTORY_SECTION_ID, label: STAFF_DIRECTORY_NAV_LABEL, icon: <NavClipboardIcon /> },
      { id: 'institutionalArchive', label: 'ארכיון מוסדי', icon: <NavArchiveIcon /> },
    )

    return items
  }, [handleReminderBellClick, unreadCount])

  function handleNavigateToInbox(intent: DashboardRequestNavigationIntent) {
    setRequestNavigationIntent(intent)
    showSection('requestsInbox')
  }

  useEffect(() => {
    let isCancelled = false

    async function fetchReminderSummaries() {
      const result = await loadInstitutionRequestReminderSummaries()
      if (isCancelled || !result.ok) {
        return
      }

      setReminderSummariesByRequestId(
        new Map(result.summaries.map((summary) => [summary.request_id, summary])),
      )
    }

    void fetchReminderSummaries()

    return () => {
      isCancelled = true
    }
  }, [archiveRefreshToken, analyticsRefreshToken, unreadCount])

  useEffect(() => {
    return () => {
      if (announcementTimeoutRef.current !== null) {
        window.clearTimeout(announcementTimeoutRef.current)
      }
    }
  }, [])

  function handleArchiveChanged() {
    setArchiveRefreshToken((value) => value + 1)
    setAnalyticsRefreshToken((value) => value + 1)
  }

  return (
    <DashboardShell
      roleLabel="אזור המזכירה"
      subtitle="ברוכה הבאה לאזור המזכירה ב־EduFlow."
      profile={profile}
      navItems={secretaryNavItems}
      activeSectionId={activeSectionId}
      onSectionSelect={showSection}
      onLogout={onLogout}
    >
      <div dir="rtl" className="secretary-dashboard">
        <div className="reminder-navigation-live-region" aria-live="polite" aria-atomic="true">
          {liveAnnouncement}
        </div>

        <DashboardSectionPanel
          id="secretary-overview"
          sectionId={DASHBOARD_OVERVIEW_SECTION_ID}
          activeSectionId={activeSectionId}
          className="secretary-dashboard__shell-section"
        >
          <SecretaryAnalyticsSection
            refreshToken={analyticsRefreshToken + archiveRefreshToken}
            unreadReminderRequestIds={unreadReminderRequestIds}
            reminderSummariesByRequestId={reminderSummariesByRequestId}
            onNavigateToInbox={handleNavigateToInbox}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="secretary-substitute-approvals"
          sectionId="substituteApprovals"
          activeSectionId={activeSectionId}
          className="secretary-dashboard__shell-section"
        >
          <SecretarySubstituteApprovalsSection />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="secretary-requests-inbox"
          sectionId="requestsInbox"
          activeSectionId={activeSectionId}
          className="secretary-dashboard__shell-section"
        >
          <SecretaryRequestsInbox
            onArchived={handleArchiveChanged}
            institutionId={profile.school?.id ?? null}
            unreadReminderRequestIds={unreadReminderRequestIds}
            unreadMessageRequestIds={unreadMessageRequestIds}
            requestIdsWithMessages={requestIdsWithMessages}
            onConversationOpened={handleConversationOpened}
            reminderNavigationIntent={navigationIntent}
            highlightedRequestId={highlightedRequestId}
            onReminderNavigationComplete={handleReminderNavigationComplete}
            requestNavigationIntent={requestNavigationIntent}
            onRequestNavigationIntentConsumed={() => setRequestNavigationIntent(null)}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="secretary-meeting-calendar"
          sectionId={MEETING_CALENDAR_SECTION_ID}
          activeSectionId={activeSectionId}
          className="secretary-dashboard__shell-section"
        >
          <MeetingCalendarSection actorUserId={profile.id} actorRole="secretary" />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="secretary-staff-directory"
          sectionId={STAFF_DIRECTORY_SECTION_ID}
          activeSectionId={activeSectionId}
          className="secretary-dashboard__shell-section"
        >
          <StaffDirectoryPage
            canEdit={false}
            institutionName={profile.school?.name ?? ''}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="secretary-institutional-archive"
          sectionId="institutionalArchive"
          activeSectionId={activeSectionId}
          className="secretary-dashboard__shell-section"
        >
          <SecretaryArchiveSection
            refreshToken={archiveRefreshToken}
            unreadMessageRequestIds={unreadMessageRequestIds}
            requestIdsWithMessages={requestIdsWithMessages}
            onConversationOpened={handleConversationOpened}
            reminderNavigationIntent={navigationIntent}
            onReminderNavigationComplete={handleReminderNavigationComplete}
          />
        </DashboardSectionPanel>
      </div>
    </DashboardShell>
  )
}
