import type { CalendarViewMode, ConfirmedCalendarEvent } from '../../utils/meetingCalendarView'
import {
  formatCalendarPeriodLabel,
  shiftCalendarAnchor,
} from '../../utils/meetingCalendarView'
import { MeetingMonthView } from './MeetingMonthView'
import { MeetingWeekView } from './MeetingWeekView'

type MeetingCalendarBoardProps = {
  viewMode: CalendarViewMode
  anchorDate: Date
  events: ConfirmedCalendarEvent[]
  isLoading: boolean
  onViewModeChange: (mode: CalendarViewMode) => void
  onAnchorDateChange: (date: Date) => void
  onSelectEvent: (meetingId: string) => void
}

export function MeetingCalendarBoard({
  viewMode,
  anchorDate,
  events,
  isLoading,
  onViewModeChange,
  onAnchorDateChange,
  onSelectEvent,
}: MeetingCalendarBoardProps) {
  const periodLabel = formatCalendarPeriodLabel(anchorDate, viewMode)

  return (
    <section className="mc-calendar-board" aria-label="לוח שנה">
      <div className="mc-calendar-board__toolbar">
        <div className="mc-calendar-board__modes" role="group" aria-label="בחירת תצוגה">
          <button
            type="button"
            className={`ds-btn ${viewMode === 'month' ? 'ds-btn--primary' : 'ds-btn--secondary'}`}
            aria-pressed={viewMode === 'month'}
            onClick={() => onViewModeChange('month')}
          >
            חודש
          </button>
          <button
            type="button"
            className={`ds-btn ${viewMode === 'week' ? 'ds-btn--primary' : 'ds-btn--secondary'}`}
            aria-pressed={viewMode === 'week'}
            onClick={() => onViewModeChange('week')}
          >
            שבוע
          </button>
        </div>

        <div className="mc-calendar-board__nav" role="group" aria-label="ניווט בלוח השנה">
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={() => onAnchorDateChange(shiftCalendarAnchor(anchorDate, viewMode, -1))}
          >
            הקודם
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={() => onAnchorDateChange(new Date())}
          >
            היום
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={() => onAnchorDateChange(shiftCalendarAnchor(anchorDate, viewMode, 1))}
          >
            הבא
          </button>
        </div>

        <h3 className="mc-calendar-board__period" aria-live="polite">
          {periodLabel}
        </h3>
      </div>

      {isLoading ? (
        <p className="mc-calendar-board__status" role="status">
          טוען לוח שנה…
        </p>
      ) : events.length === 0 ? (
        <p className="ds-empty-state">אין פגישות מתוכננות.</p>
      ) : null}

      {!isLoading ? (
        viewMode === 'month' ? (
          <MeetingMonthView
            anchorDate={anchorDate}
            events={events}
            onSelectEvent={onSelectEvent}
          />
        ) : (
          <MeetingWeekView
            anchorDate={anchorDate}
            events={events}
            onSelectEvent={onSelectEvent}
          />
        )
      ) : null}
    </section>
  )
}
