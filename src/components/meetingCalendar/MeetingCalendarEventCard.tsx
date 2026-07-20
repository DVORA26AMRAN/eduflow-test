import { translateRole } from '../../utils/roles'
import {
  formatEventTimeRange,
  getParticipantRoleTone,
  type ConfirmedCalendarEvent,
} from '../../utils/meetingCalendarView'

type MeetingCalendarEventCardProps = {
  event: ConfirmedCalendarEvent
  onSelect: (meetingId: string) => void
}

export function MeetingCalendarEventCard({ event, onSelect }: MeetingCalendarEventCardProps) {
  const tone = getParticipantRoleTone(event.participantRole)
  const roleLabel = event.participantRole ? translateRole(event.participantRole) : 'משתתף'

  return (
    <button
      type="button"
      className={`mc-event-card mc-event-card--${tone}`}
      onClick={() => onSelect(event.meetingId)}
      aria-label={`${event.subject}, ${formatEventTimeRange(event.startsAt, event.endsAt, event.timeZone)}, ${event.participantName}, ${roleLabel}`}
    >
      <span className="mc-event-card__subject">{event.subject}</span>
      <span className="mc-event-card__time">
        {formatEventTimeRange(event.startsAt, event.endsAt, event.timeZone)}
      </span>
      <span className="mc-event-card__participant">
        {event.participantName} · {roleLabel}
      </span>
    </button>
  )
}
