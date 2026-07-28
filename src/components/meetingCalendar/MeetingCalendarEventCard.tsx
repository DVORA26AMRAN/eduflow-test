import { translateRole } from '../../utils/roles'
import { getMeetingLiveStatus } from '../../utils/meetingCalendarLive'
import {
  formatEventTimeRange,
  getParticipantRoleTone,
  type ConfirmedCalendarEvent,
} from '../../utils/meetingCalendarView'

type MeetingCalendarEventCardProps = {
  event: ConfirmedCalendarEvent
  onSelect: (meetingId: string) => void
  now?: Date
}

export function MeetingCalendarEventCard({
  event,
  onSelect,
  now = new Date(),
}: MeetingCalendarEventCardProps) {
  const tone = getParticipantRoleTone(event.participantRole)
  const roleLabel = event.participantRole ? translateRole(event.participantRole) : 'משתתף'
  const liveStatus = getMeetingLiveStatus(event.startsAt, event.endsAt, now)

  return (
    <button
      type="button"
      className={`mc-event-card mc-event-card--${tone}`}
      onClick={() => onSelect(event.meetingId)}
      aria-label={`${event.subject}, ${formatEventTimeRange(event.startsAt, event.endsAt, event.timeZone)}, ${event.participantName}, ${roleLabel}${liveStatus.label ? `, ${liveStatus.label}` : ''}`}
    >
      <span className="mc-event-card__subject">{event.subject}</span>
      <span className="mc-event-card__time">
        {formatEventTimeRange(event.startsAt, event.endsAt, event.timeZone)}
      </span>
      {liveStatus.label ? (
        <span className={`mc-event-card__live mc-live-status--${liveStatus.kind}`}>
          {liveStatus.label}
        </span>
      ) : null}
      <span className="mc-event-card__participant">
        {event.participantName} · {roleLabel}
      </span>
    </button>
  )
}
