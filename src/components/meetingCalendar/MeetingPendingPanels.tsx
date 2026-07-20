import type { Meeting } from '../../types/meetingCalendar'
import {
  getMeetingParticipantLabel,
  translateMeetingState,
  type MeetingUserDirectoryEntry,
} from '../../utils/meetingCalendarDisplay'
import {
  MEETING_PHASE3_PANEL_ORDER,
  translateMeetingPhase3Panel,
  type MeetingPhase3PanelId,
} from '../../utils/meetingCalendarView'

type MeetingPendingPanelsProps = {
  panels: Record<MeetingPhase3PanelId, Meeting[]>
  actorUserId: string
  directory: Map<string, MeetingUserDirectoryEntry>
  isLoading: boolean
  onSelectMeeting: (meetingId: string) => void
}

export function MeetingPendingPanels({
  panels,
  actorUserId,
  directory,
  isLoading,
  onSelectMeeting,
}: MeetingPendingPanelsProps) {
  if (isLoading) {
    return (
      <section className="mc-pending-panels" aria-label="פגישות ממתינות">
        <p role="status">טוען רשימות ממתינות…</p>
      </section>
    )
  }

  return (
    <section className="mc-pending-panels" aria-label="פגישות ממתינות">
      {MEETING_PHASE3_PANEL_ORDER.map((panelId) => {
        const items = panels[panelId]
        return (
          <section
            key={panelId}
            className="mc-bucket"
            aria-labelledby={`mc-phase3-panel-${panelId}`}
          >
            <h3 id={`mc-phase3-panel-${panelId}`}>{translateMeetingPhase3Panel(panelId)}</h3>
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
                        onClick={() => onSelectMeeting(meeting.id)}
                      >
                        <strong>{meeting.subject}</strong>
                        <span>{getMeetingParticipantLabel(directory, otherId)}</span>
                        <span>{translateMeetingState(meeting.currentState)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </section>
  )
}
