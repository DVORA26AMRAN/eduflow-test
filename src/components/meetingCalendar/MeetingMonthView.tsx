import {
  buildMonthDayCells,
  getMeetingCalendarWeekdayLabels,
  groupEventsByDateKey,
  type ConfirmedCalendarEvent,
} from '../../utils/meetingCalendarView'
import { MeetingCalendarEventCard } from './MeetingCalendarEventCard'

type MeetingMonthViewProps = {
  anchorDate: Date
  events: ConfirmedCalendarEvent[]
  onSelectEvent: (meetingId: string) => void
}

export function MeetingMonthView({
  anchorDate,
  events,
  onSelectEvent,
}: MeetingMonthViewProps) {
  const cells = buildMonthDayCells(anchorDate)
  const eventsByDay = groupEventsByDateKey(events)
  const weekdays = getMeetingCalendarWeekdayLabels()

  return (
    <div className="mc-month" role="grid" aria-label="תצוגת חודש">
      <div className="mc-month__weekdays" role="row">
        {weekdays.map((label) => (
          <div key={label} className="mc-month__weekday" role="columnheader">
            {label}
          </div>
        ))}
      </div>
      <div className="mc-month__days">
        {cells.map((cell) => {
          const dayEvents = eventsByDay.get(cell.dateKey) ?? []
          return (
            <div
              key={cell.dateKey}
              className={[
                'mc-month__day',
                cell.inCurrentMonth ? '' : 'mc-month__day--outside',
                cell.isToday ? 'mc-month__day--today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role="gridcell"
              aria-label={cell.date.toLocaleDateString('he-IL')}
            >
              <span className="mc-month__day-number">{cell.date.getDate()}</span>
              <div className="mc-month__day-events">
                {dayEvents.map((event) => (
                  <MeetingCalendarEventCard
                    key={event.meetingId}
                    event={event}
                    onSelect={onSelectEvent}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
