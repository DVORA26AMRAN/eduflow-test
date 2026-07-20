import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Meeting, MeetingCalendarRole, MeetingSlot } from '../../types/meetingCalendar'
import { isMeetingCalendarRole } from '../../utils/meetingCalendar'
import {
  loadConfirmedMeetingsInRange,
  loadPendingMeetings,
  loadUpcomingConfirmedMeetings,
  type ConfirmedMeetingWithSlot,
} from '../../services/meetingCalendar'
import {
  loadEligibleMeetingRecipients,
  loadMeetingUserDirectory,
} from '../../services/meetingRecipients'
import {
  MEETING_CALENDAR_NAV_LABEL,
  classifyMeetingPendingBucket,
  type MeetingUserDirectoryEntry,
} from '../../utils/meetingCalendarDisplay'
import {
  buildConfirmedCalendarEvents,
  buildPhase3PendingPanels,
  getVisibleCalendarRange,
  startOfDay,
  type CalendarViewMode,
} from '../../utils/meetingCalendarView'
import { DashboardSection } from '../dashboard/DashboardSection'
import { CreateMeetingModal } from './CreateMeetingModal'
import { MeetingActionModal } from './MeetingActionModal'
import { MeetingCalendarBoard } from './MeetingCalendarBoard'
import { MeetingDetailsDialog } from './MeetingDetailsDialog'
import { MeetingNotificationsPanel } from './MeetingNotificationsPanel'
import { MeetingPendingPanels } from './MeetingPendingPanels'
import './MeetingCalendar.css'

type MeetingCalendarSectionProps = {
  actorUserId: string
  actorRole: MeetingCalendarRole
}

type DialogMode = 'action' | 'details'

function toMeetingsAndSlots(items: ConfirmedMeetingWithSlot[]): {
  meetings: Meeting[]
  slots: MeetingSlot[]
} {
  return {
    meetings: items.map((item) => item.meeting),
    slots: items.map((item) => item.slot),
  }
}

export function MeetingCalendarSection({ actorUserId, actorRole }: MeetingCalendarSectionProps) {
  const [pendingMeetings, setPendingMeetings] = useState<Meeting[]>([])
  const [rangeMeetings, setRangeMeetings] = useState<Meeting[]>([])
  const [rangeSlots, setRangeSlots] = useState<MeetingSlot[]>([])
  const [upcomingMeetings, setUpcomingMeetings] = useState<Meeting[]>([])
  const [upcomingSlots, setUpcomingSlots] = useState<MeetingSlot[]>([])
  const [directoryList, setDirectoryList] = useState<MeetingUserDirectoryEntry[]>([])
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(true)
  const [isLoadingPending, setIsLoadingPending] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null)
  const [dialogMode, setDialogMode] = useState<DialogMode>('action')
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month')
  const [anchorDate, setAnchorDate] = useState(() => new Date())

  const directory = useMemo(() => {
    const map = new Map<string, MeetingUserDirectoryEntry>()
    for (const entry of directoryList) {
      map.set(entry.id, entry)
    }
    return map
  }, [directoryList])

  const slotsById = useMemo(() => {
    const map = new Map<string, MeetingSlot>()
    for (const slot of [...rangeSlots, ...upcomingSlots]) {
      map.set(slot.id, slot)
    }
    return map
  }, [rangeSlots, upcomingSlots])

  const meetingsById = useMemo(() => {
    const map = new Map<string, Meeting>()
    for (const meeting of [...pendingMeetings, ...rangeMeetings, ...upcomingMeetings]) {
      map.set(meeting.id, meeting)
    }
    return map
  }, [pendingMeetings, rangeMeetings, upcomingMeetings])

  const eligibleRecipients = useMemo(
    () => loadEligibleMeetingRecipients(directoryList, actorUserId, actorRole),
    [directoryList, actorUserId, actorRole],
  )

  const visibleRange = useMemo(
    () => getVisibleCalendarRange(anchorDate, viewMode),
    [anchorDate, viewMode],
  )

  const visibleEvents = useMemo(
    () =>
      buildConfirmedCalendarEvents({
        meetings: rangeMeetings,
        slotsById,
        directory,
        actorUserId,
      }),
    [rangeMeetings, slotsById, directory, actorUserId],
  )

  const pendingPanels = useMemo(
    () =>
      buildPhase3PendingPanels({
        pendingMeetings,
        upcomingMeetings,
        actorUserId,
      }),
    [pendingMeetings, upcomingMeetings, actorUserId],
  )

  const activeMeeting = activeMeetingId ? (meetingsById.get(activeMeetingId) ?? null) : null

  const activeConfirmedSlot = useMemo(() => {
    if (!activeMeeting?.confirmedSlotId) {
      return null
    }
    return slotsById.get(activeMeeting.confirmedSlotId) ?? null
  }, [activeMeeting, slotsById])

  const loadDirectory = useCallback(async () => {
    const directoryResult = await loadMeetingUserDirectory()
    if (!directoryResult.ok) {
      setErrorMessage(directoryResult.errorMessage)
      return directoryResult
    }
    setDirectoryList(directoryResult.users)
    return directoryResult
  }, [])

  const loadPending = useCallback(async () => {
    setIsLoadingPending(true)
    const pendingResult = await loadPendingMeetings()
    setIsLoadingPending(false)

    if (!pendingResult.ok) {
      setErrorMessage(pendingResult.errorMessage)
      setPendingMeetings([])
      return pendingResult
    }

    setPendingMeetings(pendingResult.meetings)
    return pendingResult
  }, [])

  const loadUpcoming = useCallback(async () => {
    const upcomingResult = await loadUpcomingConfirmedMeetings({
      from: startOfDay(new Date()),
    })
    if (!upcomingResult.ok) {
      setErrorMessage(upcomingResult.errorMessage)
      setUpcomingMeetings([])
      setUpcomingSlots([])
      return upcomingResult
    }

    const mapped = toMeetingsAndSlots(upcomingResult.items)
    setUpcomingMeetings(mapped.meetings)
    setUpcomingSlots(mapped.slots)
    return upcomingResult
  }, [])

  const loadRange = useCallback(async (rangeStart: Date, rangeEnd: Date) => {
    setIsLoadingCalendar(true)
    const rangeResult = await loadConfirmedMeetingsInRange({ rangeStart, rangeEnd })
    setIsLoadingCalendar(false)

    if (!rangeResult.ok) {
      setErrorMessage(rangeResult.errorMessage)
      setRangeMeetings([])
      setRangeSlots([])
      return rangeResult
    }

    const mapped = toMeetingsAndSlots(rangeResult.items)
    setRangeMeetings(mapped.meetings)
    setRangeSlots(mapped.slots)
    return rangeResult
  }, [])

  const refreshAll = useCallback(async () => {
    setErrorMessage('')
    const range = getVisibleCalendarRange(anchorDate, viewMode)

    const [directoryResult, pendingResult, upcomingResult, rangeResult] = await Promise.all([
      loadDirectory(),
      loadPending(),
      loadUpcoming(),
      loadRange(range.rangeStart, range.rangeEnd),
    ])

    if (
      !directoryResult.ok ||
      !pendingResult.ok ||
      !upcomingResult.ok ||
      !rangeResult.ok
    ) {
      return
    }

    setErrorMessage('')
  }, [anchorDate, viewMode, loadDirectory, loadPending, loadUpcoming, loadRange])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const [directoryResult, pendingResult, upcomingResult] = await Promise.all([
        loadDirectory(),
        loadPending(),
        loadUpcoming(),
      ])

      if (cancelled) {
        return
      }

      if (!directoryResult.ok || !pendingResult.ok || !upcomingResult.ok) {
        return
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loadDirectory, loadPending, loadUpcoming])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const result = await loadRange(visibleRange.rangeStart, visibleRange.rangeEnd)
      if (cancelled || !result.ok) {
        return
      }
    })()

    return () => {
      cancelled = true
    }
  }, [visibleRange.rangeStart, visibleRange.rangeEnd, loadRange])

  function openPendingMeeting(meetingId: string) {
    const meeting = meetingsById.get(meetingId)
    if (!meeting) {
      return
    }
    const bucket = classifyMeetingPendingBucket(meeting, actorUserId)
    setDialogMode(bucket === 'confirmed' ? 'details' : 'action')
    setActiveMeetingId(meetingId)
  }

  function openCalendarMeeting(meetingId: string) {
    const meeting = meetingsById.get(meetingId)
    if (!meeting) {
      return
    }

    if (meeting.reschedulingActive) {
      const bucket = classifyMeetingPendingBucket(meeting, actorUserId)
      setDialogMode(bucket === 'confirmed' || bucket == null ? 'details' : 'action')
    } else {
      setDialogMode('details')
    }
    setActiveMeetingId(meetingId)
  }

  function openFromNotification(meetingId: string) {
    const meeting = meetingsById.get(meetingId)
    if (!meeting) {
      setActiveMeetingId(meetingId)
      setDialogMode('details')
      void refreshAll()
      return
    }

    if (meeting.currentState === 'CONFIRMED' && !meeting.reschedulingActive) {
      setDialogMode('details')
    } else {
      const bucket = classifyMeetingPendingBucket(meeting, actorUserId)
      setDialogMode(bucket === 'confirmed' ? 'details' : 'action')
    }
    setActiveMeetingId(meetingId)
  }

  function handleRescheduleStarted(meetingId: string) {
    setDialogMode('action')
    setActiveMeetingId(meetingId)
  }

  return (
    <DashboardSection title={MEETING_CALENDAR_NAV_LABEL}>
      <div className="mc-section">
        <p className="mc-help-text">תיאום פגישות בין מורות, מזכירות ומנהלות לפי התהליך המאושר.</p>
        <div className="mc-section__toolbar">
          <button type="button" className="ds-btn ds-btn--primary" onClick={() => setCreateOpen(true)}>
            יצירת פגישה
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={() => void refreshAll()}
            disabled={isLoadingCalendar || isLoadingPending}
          >
            רענון
          </button>
        </div>

        {errorMessage ? (
          <p className="ds-form-message ds-form-message--error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="mc-layout">
          <MeetingCalendarBoard
            viewMode={viewMode}
            anchorDate={anchorDate}
            events={visibleEvents}
            isLoading={isLoadingCalendar}
            onViewModeChange={setViewMode}
            onAnchorDateChange={setAnchorDate}
            onSelectEvent={openCalendarMeeting}
          />

          <aside className="mc-sidebar" aria-label="פעולות ממתינות והתראות">
            <MeetingPendingPanels
              panels={pendingPanels}
              actorUserId={actorUserId}
              directory={directory}
              isLoading={isLoadingPending}
              onSelectMeeting={openPendingMeeting}
            />
            <MeetingNotificationsPanel
              actorUserId={actorUserId}
              onOpenMeeting={openFromNotification}
            />
          </aside>
        </div>
      </div>

      {createOpen ? (
        <CreateMeetingModal
          isOpen
          actorRole={actorRole}
          eligibleRecipients={eligibleRecipients}
          onClose={() => setCreateOpen(false)}
          onCreated={() => void refreshAll()}
        />
      ) : null}

      {activeMeeting && dialogMode === 'action' ? (
        <MeetingActionModal
          key={`action:${activeMeeting.id}:${activeMeeting.activeProposalCycle}`}
          isOpen
          meeting={activeMeeting}
          actorUserId={actorUserId}
          directory={directory}
          onClose={() => setActiveMeetingId(null)}
          onChanged={() => void refreshAll()}
        />
      ) : null}

      {activeMeeting && dialogMode === 'details' ? (
        <MeetingDetailsDialog
          key={`details:${activeMeeting.id}`}
          isOpen
          meeting={activeMeeting}
          actorUserId={actorUserId}
          directory={directory}
          confirmedSlot={activeConfirmedSlot}
          onClose={() => setActiveMeetingId(null)}
          onChanged={() => void refreshAll()}
          onRescheduleStarted={handleRescheduleStarted}
        />
      ) : null}
    </DashboardSection>
  )
}

export function MeetingCalendarSectionForProfile(props: {
  actorUserId: string
  actorRole: string
}) {
  if (!isMeetingCalendarRole(props.actorRole)) {
    return null
  }

  return (
    <MeetingCalendarSection actorUserId={props.actorUserId} actorRole={props.actorRole} />
  )
}
