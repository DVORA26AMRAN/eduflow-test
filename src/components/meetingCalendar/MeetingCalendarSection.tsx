import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MeetingCalendarRole, Meeting } from '../../types/meetingCalendar'
import { isMeetingCalendarRole } from '../../utils/meetingCalendar'
import { loadMeetings } from '../../services/meetingCalendar'
import {
  loadEligibleMeetingRecipients,
  loadMeetingUserDirectory,
} from '../../services/meetingRecipients'
import {
  MEETING_CALENDAR_NAV_LABEL,
  getMeetingParticipantLabel,
  groupMeetingsByPendingBucket,
  translateMeetingPendingBucket,
  translateMeetingState,
  type MeetingPendingBucket,
  type MeetingUserDirectoryEntry,
} from '../../utils/meetingCalendarDisplay'
import { DashboardSection } from '../dashboard/DashboardSection'
import { CreateMeetingModal } from './CreateMeetingModal'
import { MeetingActionModal } from './MeetingActionModal'
import './MeetingCalendar.css'

const BUCKET_ORDER: MeetingPendingBucket[] = [
  'waiting_for_my_approval',
  'waiting_for_me_to_propose',
  'waiting_for_me_to_choose',
  'waiting_for_my_final_confirmation',
  'waiting_for_other',
  'confirmed',
]

type MeetingCalendarSectionProps = {
  actorUserId: string
  actorRole: MeetingCalendarRole
}

export function MeetingCalendarSection({ actorUserId, actorRole }: MeetingCalendarSectionProps) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [directoryList, setDirectoryList] = useState<MeetingUserDirectoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null)

  const directory = useMemo(() => {
    const map = new Map<string, MeetingUserDirectoryEntry>()
    for (const entry of directoryList) {
      map.set(entry.id, entry)
    }
    return map
  }, [directoryList])

  const eligibleRecipients = useMemo(
    () => loadEligibleMeetingRecipients(directoryList, actorUserId, actorRole),
    [directoryList, actorUserId, actorRole],
  )

  const grouped = useMemo(
    () => groupMeetingsByPendingBucket(meetings, actorUserId),
    [meetings, actorUserId],
  )

  const activeMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === activeMeetingId) ?? null,
    [meetings, activeMeetingId],
  )

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')

    const [meetingsResult, directoryResult] = await Promise.all([
      loadMeetings(),
      loadMeetingUserDirectory(),
    ])

    setIsLoading(false)

    if (!meetingsResult.ok) {
      setErrorMessage(meetingsResult.errorMessage)
      return
    }
    if (!directoryResult.ok) {
      setErrorMessage(directoryResult.errorMessage)
      return
    }

    setMeetings(meetingsResult.meetings)
    setDirectoryList(directoryResult.users)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <DashboardSection title={MEETING_CALENDAR_NAV_LABEL}>
      <div className="mc-section">
        <p className="mc-help-text">תיאום פגישות בין מורות, מזכירות ומנהלות לפי התהליך המאושר.</p>
        <div className="mc-section__toolbar">
          <button type="button" className="ds-button" onClick={() => setCreateOpen(true)}>
            יצירת פגישה
          </button>
          <button
            type="button"
            className="ds-button ds-button--secondary"
            onClick={() => void refresh()}
            disabled={isLoading}
          >
            רענון
          </button>
        </div>

        {isLoading ? <p>טוען פגישות…</p> : null}
        {errorMessage ? (
          <p className="ds-form-message ds-form-message--error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {!isLoading && !errorMessage
          ? BUCKET_ORDER.map((bucket) => {
              const items = grouped[bucket]
              return (
                <section key={bucket} className="mc-bucket" aria-labelledby={`mc-bucket-${bucket}`}>
                  <h3 id={`mc-bucket-${bucket}`}>{translateMeetingPendingBucket(bucket)}</h3>
                  {items.length === 0 ? (
                    <p className="ds-empty-state">אין פגישות בקטגוריה זו.</p>
                  ) : (
                    <ul className="mc-meeting-list">
                      {items.map((meeting) => {
                        const otherId =
                          meeting.requesterId === actorUserId
                            ? meeting.recipientId
                            : meeting.requesterId
                        return (
                          <li key={meeting.id}>
                            <button
                              type="button"
                              className="mc-meeting-card"
                              onClick={() => setActiveMeetingId(meeting.id)}
                            >
                              <strong>{meeting.subject}</strong>
                              <span>{getMeetingParticipantLabel(directory, otherId)}</span>
                              <span>{translateMeetingState(meeting.currentState)}</span>
                              <span>{new Date(meeting.createdAt).toLocaleDateString('he-IL')}</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )
            })
          : null}
      </div>

      <CreateMeetingModal
        isOpen={createOpen}
        actorRole={actorRole}
        eligibleRecipients={eligibleRecipients}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void refresh()}
      />

      <MeetingActionModal
        isOpen={activeMeetingId !== null}
        meeting={activeMeeting}
        actorUserId={actorUserId}
        directory={directory}
        onClose={() => setActiveMeetingId(null)}
        onChanged={() => void refresh()}
      />
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
