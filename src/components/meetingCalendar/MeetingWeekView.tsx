import {
  buildWeekDayCells,
  getMeetingCalendarWeekdayLabels,
  groupEventsByDateKey,
  type ConfirmedCalendarEvent,
} from '../../utils/meetingCalendarView'
import { MeetingCalendarEventCard } from './MeetingCalendarEventCard'

type MeetingWeekViewProps = {
  anchorDate: Date
  events: ConfirmedCalendarEvent[]
  onSelectEvent: (meetingId: string) => void
}

export function MeetingWeekView({
  anchorDate,
  events,
  onSelectEvent,
}: MeetingWeekViewProps) {
  const cells = buildWeekDayCells(anchorDate)
  const eventsByDay = groupEventsByDateKey(events)
  const weekdays = getMeetingCalendarWeekdayLabels()

  return (
    <div className="mc-week" role="grid" aria-label="תצוגת שבוע">
      <div className="mc-week__days">
        {cells.map((cell, index) => {
          const dayEvents = eventsByDay.get(cell.dateKey) ?? []
          return (
            <div
              key={cell.dateKey}
              className={['mc-week__day', cell.isToday ? 'mc-week__day--today' : '']
                .filter(Boolean)
                .join(' ')}
              role="gridcell"
              aria-label={`${weekdays[index]} ${cell.date.toLocaleDateString('he-IL')}`}
            >
              <div className="mc-week__day-header">
                <span>{weekdays[index]}</span>
                <strong>{cell.date.getDate()}</strong>
              </div>
              <div className="mc-week__day-events">
                {dayEvents.length === 0 ? (
                  <p className="mc-week__empty">אין פגישות</p>
                ) : (
                  dayEvents.map((event) => (
                    <MeetingCalendarEventCard
                      key={event.meetingId}
                      event={event}
                      onSelect={onSelectEvent}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
