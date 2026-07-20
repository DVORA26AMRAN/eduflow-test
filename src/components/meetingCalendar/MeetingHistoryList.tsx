import { useEffect, useState } from 'react'
import type { MeetingAuditEvent } from '../../types/meetingCalendar'
import { loadMeetingAuditEvents } from '../../services/meetingCalendar'
import type { MeetingUserDirectoryEntry } from '../../utils/meetingCalendarDisplay'
import {
  describeMeetingAuditEvent,
  sortMeetingAuditEventsNewestFirst,
} from '../../utils/meetingCalendarLifecycle'

type MeetingHistoryListProps = {
  meetingId: string
  directory: Map<string, MeetingUserDirectoryEntry>
}

export function MeetingHistoryList({ meetingId, directory }: MeetingHistoryListProps) {
  const [events, setEvents] = useState<MeetingAuditEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    void loadMeetingAuditEvents(meetingId).then((result) => {
      if (cancelled) {
        return
      }
      setIsLoading(false)
      if (!result.ok) {
        setErrorMessage(result.errorMessage)
        setEvents([])
        return
      }
      setEvents(sortMeetingAuditEventsNewestFirst(result.events))
    })

    return () => {
      cancelled = true
    }
  }, [meetingId])

  if (isLoading) {
    return <p role="status">טוען היסטוריית פגישה…</p>
  }

  if (errorMessage) {
    return (
      <p className="ds-form-message ds-form-message--error" role="alert">
        {errorMessage}
      </p>
    )
  }

  if (events.length === 0) {
    return <p className="ds-empty-state">אין עדיין היסטוריה לפגישה זו.</p>
  }

  return (
    <section className="mc-history" aria-label="היסטוריית פגישה">
      <h3 className="mc-history__title">היסטוריית פגישה</h3>
      <ol className="mc-history__list">
        {events.map((event) => (
          <li key={event.id} className="mc-history__item">
            <strong>{describeMeetingAuditEvent(event, directory)}</strong>
            <span>{new Date(event.createdAt).toLocaleString('he-IL')}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
