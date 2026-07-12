import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DashboardShell } from '../components/dashboard/DashboardShell'

import {

  NavArchiveIcon,

  NavBellIcon,

  NavInboxIcon,

  NavUsersIcon,

  type DashboardNavItem,

} from '../components/dashboard/dashboardNav'

import { SecretaryArchiveSection } from '../components/secretary/SecretaryArchiveSection'

import { SecretaryRequestsInbox } from '../components/secretary/SecretaryRequestsInbox'

import { SecretarySubstituteApprovalsSection } from '../components/secretary/SecretarySubstituteApprovalsSection'

import { useAdminReminderNotifications } from '../hooks/useAdminReminderNotifications'

import { useReminderBellNavigation } from '../hooks/useReminderBellNavigation'

import { resolveSecretaryReminderRequestLocation } from '../services/reminderRequestLocation'

import {

  REMINDER_BELL_NAV_ID,

  REMINDER_NAV_ARIA_LABEL,

  REMINDER_NAV_LABEL,

} from '../utils/reminderNavigation'

import type { AuthenticatedUserProfile } from '../types/user'

import './SecretaryDashboardPage.css'



type SecretaryDashboardPageProps = {

  profile: AuthenticatedUserProfile

  onLogout: () => void

}



export function SecretaryDashboardPage({ profile, onLogout }: SecretaryDashboardPageProps) {

  const [activeSectionId, setActiveSectionId] = useState<string>('substituteApprovals')

  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0)

  const [liveAnnouncement, setLiveAnnouncement] = useState('')

  const announcementTimeoutRef = useRef<number | null>(null)



  const {

    unreadCount,

    unreadReminderRequestIds,

    getNewestUnreadReminder,

    markReminderNotificationAsRead,

  } = useAdminReminderNotifications()



  const scrollToSection = useCallback((sectionId: string) => {

    const target = document.querySelector<HTMLElement>(

      `.secretary-dashboard [data-section-id="${sectionId}"]`,

    )

    if (!target) {

      return

    }



    setActiveSectionId(sectionId)

    target.scrollIntoView({ behavior: 'smooth', block: 'start' })

    requestAnimationFrame(() => target.focus({ preventScroll: true }))

  }, [])



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

    scrollToSection,

    resolveLocation: resolveSecretaryReminderRequestLocation,

    getNewestUnreadReminder,

    markReminderNotificationAsRead,

    onNavigationAnnouncement: announceNavigation,

  })



  const secretaryNavItems: DashboardNavItem[] = useMemo(() => {

    const items: DashboardNavItem[] = []



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

      { id: 'institutionalArchive', label: 'ארכיון מוסדי', icon: <NavArchiveIcon /> },

    )



    return items

  }, [handleReminderBellClick, unreadCount])



  function handleSectionSelect(sectionId: string) {

    scrollToSection(sectionId)

  }



  useEffect(() => {

    const sections = Array.from(

      document.querySelectorAll<HTMLElement>('.secretary-dashboard [data-section-id]'),

    )



    if (sections.length === 0) {

      return

    }



    const observer = new IntersectionObserver(

      (entries) => {

        const visibleEntries = entries.filter((entry) => entry.isIntersecting)

        if (visibleEntries.length === 0) {

          return

        }



        const mostVisible = visibleEntries.sort(

          (a, b) => b.intersectionRatio - a.intersectionRatio,

        )[0]

        const sectionId = mostVisible.target.getAttribute('data-section-id')

        if (sectionId) {

          setActiveSectionId(sectionId)

        }

      },

      { threshold: [0.3, 0.6], rootMargin: '-15% 0px -55% 0px' },

    )



    sections.forEach((section) => observer.observe(section))



    return () => observer.disconnect()

  }, [])



  useEffect(() => {

    return () => {

      if (announcementTimeoutRef.current !== null) {

        window.clearTimeout(announcementTimeoutRef.current)

      }

    }

  }, [])



  function handleArchiveChanged() {

    setArchiveRefreshToken((value) => value + 1)

  }



  return (

    <DashboardShell

      roleLabel="אזור המזכירה"

      subtitle="ברוכה הבאה לאזור המזכירה ב־EduFlow."

      profile={profile}

      navItems={secretaryNavItems}

      activeSectionId={activeSectionId}

      onSectionSelect={handleSectionSelect}

      onLogout={onLogout}

    >

      <div dir="rtl" className="secretary-dashboard">

        <div className="reminder-navigation-live-region" aria-live="polite" aria-atomic="true">

          {liveAnnouncement}

        </div>



        <section

          id="secretary-substitute-approvals"

          data-section-id="substituteApprovals"

          className="secretary-dashboard__shell-section"

          tabIndex={-1}

        >

          <SecretarySubstituteApprovalsSection />

        </section>



        <section

          id="secretary-requests-inbox"

          data-section-id="requestsInbox"

          className="secretary-dashboard__shell-section"

          tabIndex={-1}

        >

          <SecretaryRequestsInbox

            onArchived={handleArchiveChanged}

            institutionId={profile.school?.id ?? null}

            unreadReminderRequestIds={unreadReminderRequestIds}

            reminderNavigationIntent={navigationIntent}

            highlightedRequestId={highlightedRequestId}

            onReminderNavigationComplete={handleReminderNavigationComplete}

          />

        </section>



        <section

          id="secretary-institutional-archive"

          data-section-id="institutionalArchive"

          className="secretary-dashboard__shell-section"

          tabIndex={-1}

        >

          <SecretaryArchiveSection

            refreshToken={archiveRefreshToken}

            reminderNavigationIntent={navigationIntent}

            onReminderNavigationComplete={handleReminderNavigationComplete}

          />

        </section>

      </div>

    </DashboardShell>

  )

}

