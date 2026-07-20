import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmedCalendarEvent } from '../../utils/meetingCalendarView'
import { MeetingCalendarBoard } from './MeetingCalendarBoard'

const sampleEvent: ConfirmedCalendarEvent = {
  meetingId: 'm1',
  subject: 'שיחת תכנון',
  reason: 'תיאום שנתי',
  durationMinutes: 30,
  status: 'CONFIRMED',
  startsAt: '2026-07-15T07:00:00.000Z',
  endsAt: '2026-07-15T07:30:00.000Z',
  timeZone: 'UTC',
  participantId: 'u2',
  participantName: 'יעל כהן',
  participantRole: 'teacher',
}

describe('MeetingCalendarBoard', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders month view by default and switches to week', async () => {
    const user = userEvent.setup()
    const onViewModeChange = vi.fn()

    render(
      <MeetingCalendarBoard
        viewMode="month"
        anchorDate={new Date(2026, 6, 15)}
        events={[sampleEvent]}
        isLoading={false}
        onViewModeChange={onViewModeChange}
        onAnchorDateChange={vi.fn()}
        onSelectEvent={vi.fn()}
      />,
    )

    expect(screen.getByRole('grid', { name: 'תצוגת חודש' })).toBeInTheDocument()
    expect(screen.getByText('שיחת תכנון')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'שבוע' }))
    expect(onViewModeChange).toHaveBeenCalledWith('week')
  })

  it('supports calendar navigation controls', async () => {
    const user = userEvent.setup()
    const onAnchorDateChange = vi.fn()

    render(
      <MeetingCalendarBoard
        viewMode="month"
        anchorDate={new Date(2026, 6, 15)}
        events={[sampleEvent]}
        isLoading={false}
        onViewModeChange={vi.fn()}
        onAnchorDateChange={onAnchorDateChange}
        onSelectEvent={vi.fn()}
      />,
    )

    const navigation = screen.getByRole('group', { name: 'ניווט בלוח השנה' })
    await user.click(within(navigation).getByRole('button', { name: 'הקודם' }))
    await user.click(within(navigation).getByRole('button', { name: 'הבא' }))
    await user.click(within(navigation).getByRole('button', { name: 'היום' }))

    expect(onAnchorDateChange).toHaveBeenCalledTimes(3)
  })

  it('shows loading and empty states', () => {
    const { rerender } = render(
      <MeetingCalendarBoard
        viewMode="month"
        anchorDate={new Date(2026, 6, 15)}
        events={[]}
        isLoading
        onViewModeChange={vi.fn()}
        onAnchorDateChange={vi.fn()}
        onSelectEvent={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('טוען לוח שנה…')

    rerender(
      <MeetingCalendarBoard
        viewMode="week"
        anchorDate={new Date(2026, 6, 15)}
        events={[]}
        isLoading={false}
        onViewModeChange={vi.fn()}
        onAnchorDateChange={vi.fn()}
        onSelectEvent={vi.fn()}
      />,
    )

    expect(
      within(screen.getByRole('region', { name: 'לוח שנה' })).getByText(
        'אין פגישות מתוכננות.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'תצוגת שבוע' })).toBeInTheDocument()
  })
})