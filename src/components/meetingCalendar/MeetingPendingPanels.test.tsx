import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Meeting } from '../../types/meetingCalendar'
import type { MeetingUserDirectoryEntry } from '../../utils/meetingCalendarDisplay'
import type { MeetingPhase3PanelId } from '../../utils/meetingCalendarView'
import { MeetingPendingPanels } from './MeetingPendingPanels'

const directory = new Map<string, MeetingUserDirectoryEntry>([
  [
    'teacher-1',
    {
      id: 'teacher-1',
      fullName: 'יעל כהן',
      primaryRole: 'teacher',
      status: 'active',
    },
  ],
])

function baseMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    institutionId: 'inst-1',
    creatorId: 'manager-1',
    requesterId: 'teacher-1',
    calendarOwnerId: 'manager-1',
    recipientId: 'manager-1',
    subject: 'פגישת היכרות',
    reason: 'תיאום',
    durationMinutes: 30,
    institutionTimezone: 'Asia/Jerusalem',
    currentState: 'WAITING_FOR_OWNER_APPROVAL',
    activeProposalCycle: 1,
    reschedulingActive: false,
    reschedulingInitiatedAt: null,
    reschedulingInitiatedByUserId: null,
    confirmedSlotId: null,
    pendingSlotId: null,
    slotSelectedByUserId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const emptyPanels: Record<MeetingPhase3PanelId, Meeting[]> = {
  waiting_for_my_approval: [],
  waiting_for_me_to_propose: [],
  waiting_for_me_to_choose: [],
  waiting_for_my_final_confirmation: [],
  upcoming: [],
}

describe('MeetingPendingPanels', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders pending lists and empty states', () => {
    render(
      <MeetingPendingPanels
        panels={{
          ...emptyPanels,
          waiting_for_my_approval: [baseMeeting()],
        }}
        actorUserId="manager-1"
        directory={directory}
        isLoading={false}
        onSelectMeeting={vi.fn()}
      />,
    )

    expect(screen.getByText('ממתין לאישור שלי')).toBeInTheDocument()
    expect(screen.getByText('פגישת היכרות')).toBeInTheDocument()
    expect(screen.getAllByText('אין פגישות בקטגוריה זו.').length).toBeGreaterThan(0)
  })

  it('shows loading state and notifies selection', async () => {
    const user = userEvent.setup()
    const onSelectMeeting = vi.fn()

    const { rerender } = render(
      <MeetingPendingPanels
        panels={emptyPanels}
        actorUserId="manager-1"
        directory={directory}
        isLoading
        onSelectMeeting={onSelectMeeting}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('טוען רשימות ממתינות…')

    rerender(
      <MeetingPendingPanels
        panels={{
          ...emptyPanels,
          waiting_for_my_approval: [baseMeeting()],
        }}
        actorUserId="manager-1"
        directory={directory}
        isLoading={false}
        onSelectMeeting={onSelectMeeting}
      />,
    )

    const panel = screen.getByRole('region', { name: 'פגישות ממתינות' })
    await user.click(within(panel).getByRole('button', { name: /פגישת היכרות/ }))
    expect(onSelectMeeting).toHaveBeenCalledWith('m1')
  })
})
