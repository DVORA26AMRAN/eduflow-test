import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeetingAuditEvent } from '../../types/meetingCalendar'
import type { MeetingUserDirectoryEntry } from '../../utils/meetingCalendarDisplay'
import { MeetingHistoryList } from './MeetingHistoryList'

const { loadMeetingAuditEventsMock } = vi.hoisted(() => ({
  loadMeetingAuditEventsMock: vi.fn(),
}))

vi.mock('../../services/meetingCalendar', () => ({
  loadMeetingAuditEvents: loadMeetingAuditEventsMock,
}))

const directory = new Map<string, MeetingUserDirectoryEntry>([
  [
    'manager-1',
    {
      id: 'manager-1',
      fullName: 'נועה לוי',
      primaryRole: 'institution_manager',
      status: 'active',
    },
  ],
])

const events: MeetingAuditEvent[] = [
  {
    id: 'a2',
    meetingId: 'm1',
    institutionId: 'inst-1',
    actorUserId: 'manager-1',
    eventType: 'meeting_cancelled',
    fromState: 'CONFIRMED',
    toState: 'CANCELLED',
    proposalCycle: 1,
    slotId: null,
    metadata: { reason: 'דחוף' },
    createdAt: '2026-07-02T12:00:00.000Z',
  },
  {
    id: 'a1',
    meetingId: 'm1',
    institutionId: 'inst-1',
    actorUserId: 'manager-1',
    eventType: 'meeting_created',
    fromState: null,
    toState: 'WAITING_FOR_SLOT_PROPOSAL',
    proposalCycle: 1,
    slotId: null,
    metadata: {},
    createdAt: '2026-07-01T10:00:00.000Z',
  },
]

describe('MeetingHistoryList', () => {
  beforeEach(() => {
    loadMeetingAuditEventsMock.mockReset()
  })

  it('renders audit events newest first as read-only history', async () => {
    loadMeetingAuditEventsMock.mockResolvedValue({ ok: true, events })

    render(<MeetingHistoryList meetingId="m1" directory={directory} />)

    expect(await screen.findByRole('region', { name: 'היסטוריית פגישה' })).toBeInTheDocument()

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent(/בוטלה/)
    expect(items[0]).toHaveTextContent(/דחוף/)
    expect(items[1]).toHaveTextContent(/נוצרה/)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows an empty state when there is no history', async () => {
    loadMeetingAuditEventsMock.mockResolvedValue({ ok: true, events: [] })

    render(<MeetingHistoryList meetingId="m1" directory={directory} />)

    await waitFor(() => {
      expect(screen.getByText('אין עדיין היסטוריה לפגישה זו.')).toBeInTheDocument()
    })
  })
})
