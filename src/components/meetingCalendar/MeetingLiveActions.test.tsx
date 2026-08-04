import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeetingLiveContext } from '../../services/meetingCalendar'
import { MeetingLiveActions } from './MeetingLiveActions'
import { MeetingMeetProvisionPanel } from './MeetingMeetProvisionPanel'

const {
  reportMeetingDelayMock,
  setMeetingConnectionDetailsMock,
  recordLivePrimaryActionMock,
  requestMeetProvisionMock,
  startGoogleOAuthMock,
  getGoogleConnectionStatusMock,
} = vi.hoisted(() => ({
  reportMeetingDelayMock: vi.fn(),
  setMeetingConnectionDetailsMock: vi.fn(),
  recordLivePrimaryActionMock: vi.fn(),
  requestMeetProvisionMock: vi.fn(),
  startGoogleOAuthMock: vi.fn(),
  getGoogleConnectionStatusMock: vi.fn(),
}))

vi.mock('../../services/meetingCalendar', async () => {
  const actual = await vi.importActual<typeof import('../../services/meetingCalendar')>(
    '../../services/meetingCalendar',
  )
  return {
    ...actual,
    reportMeetingDelay: reportMeetingDelayMock,
    setMeetingConnectionDetails: setMeetingConnectionDetailsMock,
    recordLivePrimaryAction: recordLivePrimaryActionMock,
  }
})

vi.mock('../../services/meetingGoogleMeet', () => ({
  requestMeetProvision: (...args: unknown[]) => requestMeetProvisionMock(...args),
}))

vi.mock('../../services/googleOAuth', () => ({
  startGoogleOAuth: (...args: unknown[]) => startGoogleOAuthMock(...args),
  getGoogleConnectionStatus: (...args: unknown[]) => getGoogleConnectionStatusMock(...args),
}))

const baseContext: MeetingLiveContext = {
  meetingId: 'm1',
  currentState: 'CONFIRMED',
  meetingFormat: 'online',
  meetUrl: 'https://meet.google.com/abc-defg-hij',
  meetProvisionStatus: 'ready',
  meetProvisionError: null,
  phoneNumber: null,
  startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  endsAt: new Date(Date.now() + 40 * 60_000).toISOString(),
  delayMinutes: null,
  delayReportedByUserId: null,
  delayReportedAt: null,
  primaryActionAvailable: true,
  delayActionAvailable: true,
  canSetConnectionDetails: false,
  canRequestMeetProvision: false,
  isCalendarOwner: true,
  ownerGoogleConnected: true,
  ownerGoogleConnectionStatus: 'connected',
}

function onlineContext(overrides: Partial<MeetingLiveContext> = {}): MeetingLiveContext {
  return {
    ...baseContext,
    meetUrl: null,
    meetProvisionStatus: 'google_not_connected',
    primaryActionAvailable: false,
    ...overrides,
  }
}

describe('MeetingLiveActions', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    window.scrollTo = vi.fn()
    window.open = vi.fn()
    reportMeetingDelayMock.mockReset()
    setMeetingConnectionDetailsMock.mockReset()
    recordLivePrimaryActionMock.mockReset()
    requestMeetProvisionMock.mockReset()
    startGoogleOAuthMock.mockReset()
    getGoogleConnectionStatusMock.mockReset()
    reportMeetingDelayMock.mockResolvedValue({ ok: true, delayMinutes: 10 })
    recordLivePrimaryActionMock.mockResolvedValue({
      ok: true,
      eventType: 'online_meeting_opened',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      phoneNumber: null,
    })
    requestMeetProvisionMock.mockResolvedValue({
      ok: true,
      meetProvisionStatus: 'pending',
      enqueued: true,
      googleConnected: true,
      requestKey: 'adoflow-m1-slot',
      code: null,
    })
    startGoogleOAuthMock.mockResolvedValue({
      ok: true,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
    })
    getGoogleConnectionStatusMock.mockResolvedValue({
      ok: true,
      connected: true,
      connectionStatus: 'connected',
      email: 'owner@school.example',
    })
  })

  it('shows live status and online start button within the window', () => {
    render(
      <MeetingLiveActions
        meetingId="m1"
        context={baseContext}
        isLoading={false}
        onContextChanged={vi.fn()}
      />,
    )

    expect(screen.getByTestId('meet-provision-status')).toHaveTextContent('Google Meet מוכן')
    expect(screen.getByRole('button', { name: 'התחל פגישה' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'אני מאחר' })).toBeInTheDocument()
  })

  it('shows call button for phone meetings', () => {
    render(
      <MeetingLiveActions
        meetingId="m1"
        context={{
          ...baseContext,
          meetingFormat: 'phone',
          meetUrl: null,
          meetProvisionStatus: 'not_applicable',
          phoneNumber: '+972501234567',
        }}
        isLoading={false}
        onContextChanged={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'התקשר' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'התחל פגישה' })).not.toBeInTheDocument()
  })

  it('hides primary action for in-person meetings', () => {
    render(
      <MeetingLiveActions
        meetingId="m1"
        context={{
          ...baseContext,
          meetingFormat: 'in_person',
          meetUrl: null,
          meetProvisionStatus: 'not_applicable',
        }}
        isLoading={false}
        onContextChanged={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'התחל פגישה' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'התקשר' })).not.toBeInTheDocument()
  })

  it('records online open before launching Meet from stored join URL', async () => {
    render(
      <MeetingLiveActions
        meetingId="m1"
        context={baseContext}
        isLoading={false}
        onContextChanged={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'התחל פגישה' }))

    await waitFor(() => {
      expect(recordLivePrimaryActionMock).toHaveBeenCalledWith('m1')
    })
    expect(window.open).toHaveBeenCalledWith(
      'https://meet.google.com/abc-defg-hij',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('reports delay and replaces previous value via service', async () => {
    const onContextChanged = vi.fn()

    render(
      <MeetingLiveActions
        meetingId="m1"
        context={baseContext}
        isLoading={false}
        onContextChanged={onContextChanged}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'אני מאחר' }))
    fireEvent.click(screen.getByRole('radio', { name: '10 דקות' }))
    fireEvent.click(screen.getByRole('button', { name: 'אישור דיווח' }))

    await waitFor(() => {
      expect(reportMeetingDelayMock).toHaveBeenCalledWith({
        meetingId: 'm1',
        delayMinutes: 10,
      })
    })
    expect(onContextChanged).toHaveBeenCalled()
  })

  it('does not expose manual Meet URL entry in connection settings', () => {
    render(
      <MeetingLiveActions
        meetingId="m1"
        context={{ ...baseContext, canSetConnectionDetails: true }}
        isLoading={false}
        onContextChanged={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'הגדרת סוג פגישה' }))
    expect(screen.getByText(/ייווצר אוטומטית לאחר אישור/)).toBeInTheDocument()
    expect(screen.queryByLabelText('קישור Google Meet')).not.toBeInTheDocument()
  })
})

describe('MeetingMeetProvisionPanel states', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    requestMeetProvisionMock.mockReset()
    startGoogleOAuthMock.mockReset()
    getGoogleConnectionStatusMock.mockReset()
    requestMeetProvisionMock.mockResolvedValue({
      ok: true,
      meetProvisionStatus: 'pending',
      enqueued: true,
      googleConnected: true,
      requestKey: 'adoflow-m1-slot',
      code: null,
    })
    startGoogleOAuthMock.mockResolvedValue({
      ok: true,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
    })
    getGoogleConnectionStatusMock.mockResolvedValue({
      ok: true,
      connected: true,
      connectionStatus: 'connected',
      email: 'owner@school.example',
    })
  })

  it('shows Google not connected + connect CTA for owners', () => {
    render(
      <MeetingMeetProvisionPanel
        meetingId="m1"
        context={onlineContext({
          meetProvisionStatus: 'google_not_connected',
          ownerGoogleConnected: false,
          ownerGoogleConnectionStatus: 'not_connected',
          canRequestMeetProvision: true,
          isCalendarOwner: true,
        })}
        primaryActionAvailable={false}
        isOpeningMeet={false}
        onStartMeeting={vi.fn()}
        onContextChanged={vi.fn()}
      />,
    )

    expect(screen.getByTestId('meet-provision-status')).toHaveTextContent('Google לא מחובר')
    expect(screen.getByRole('button', { name: 'חבר חשבון Google' })).toBeInTheDocument()
  })

  it('shows creating state without provider internals', () => {
    render(
      <MeetingMeetProvisionPanel
        meetingId="m1"
        context={onlineContext({
          meetProvisionStatus: 'pending',
          ownerGoogleConnected: true,
          ownerGoogleConnectionStatus: 'connected',
        })}
        primaryActionAvailable={false}
        isOpeningMeet={false}
        onStartMeeting={vi.fn()}
        onContextChanged={vi.fn()}
      />,
    )

    expect(screen.getByTestId('meet-provision-status')).toHaveTextContent('יוצרים Google Meet')
    expect(screen.queryByText(/request_key|event_id|token|oauth/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'התחל פגישה' })).not.toBeInTheDocument()
  })

  it('shows failed state with retry for owners', async () => {
    const onContextChanged = vi.fn()
    render(
      <MeetingMeetProvisionPanel
        meetingId="m1"
        context={onlineContext({
          meetProvisionStatus: 'failed',
          meetProvisionError: 'provision_rejected',
          ownerGoogleConnected: true,
          ownerGoogleConnectionStatus: 'connected',
          canRequestMeetProvision: true,
          isCalendarOwner: true,
        })}
        primaryActionAvailable={false}
        isOpeningMeet={false}
        onStartMeeting={vi.fn()}
        onContextChanged={onContextChanged}
      />,
    )

    expect(screen.getByTestId('meet-provision-status')).toHaveTextContent(
      'יצירת Google Meet נכשלה',
    )
    fireEvent.click(screen.getByRole('button', { name: 'נסה שוב' }))
    await waitFor(() => {
      expect(requestMeetProvisionMock).toHaveBeenCalledWith('m1')
    })
    expect(onContextChanged).toHaveBeenCalled()
  })

  it('shows reauthorization required with connect CTA', () => {
    render(
      <MeetingMeetProvisionPanel
        meetingId="m1"
        context={onlineContext({
          meetProvisionStatus: 'google_not_connected',
          meetProvisionError: 'REAUTHORIZATION_REQUIRED',
          ownerGoogleConnected: false,
          ownerGoogleConnectionStatus: 'reauthorization_required',
          canRequestMeetProvision: true,
          isCalendarOwner: true,
        })}
        primaryActionAvailable={false}
        isOpeningMeet={false}
        onStartMeeting={vi.fn()}
        onContextChanged={vi.fn()}
      />,
    )

    expect(screen.getByTestId('meet-provision-status')).toHaveTextContent(
      'נדרש חיבור מחדש לחשבון Google',
    )
    expect(screen.getByRole('button', { name: 'חבר חשבון Google' })).toBeInTheDocument()
  })

  it('shows create Meet when Google is active despite stale meeting reauth error', () => {
    render(
      <MeetingMeetProvisionPanel
        meetingId="m1"
        context={onlineContext({
          meetProvisionStatus: 'google_not_connected',
          meetProvisionError: 'REAUTHORIZATION_REQUIRED',
          ownerGoogleConnected: true,
          ownerGoogleConnectionStatus: 'connected',
          canRequestMeetProvision: true,
          isCalendarOwner: true,
        })}
        primaryActionAvailable={false}
        isOpeningMeet={false}
        onStartMeeting={vi.fn()}
        onContextChanged={vi.fn()}
      />,
    )

    expect(screen.getByTestId('meet-provision-status')).toHaveTextContent(
      'מוכן ליצירת Google Meet',
    )
    expect(screen.getByRole('button', { name: 'צור Google Meet' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'חבר חשבון Google' })).not.toBeInTheDocument()
  })

  it('shows create Meet CTA when connected and provision available', async () => {
    const onContextChanged = vi.fn()
    render(
      <MeetingMeetProvisionPanel
        meetingId="m1"
        context={onlineContext({
          meetProvisionStatus: 'google_not_connected',
          ownerGoogleConnected: true,
          ownerGoogleConnectionStatus: 'connected',
          canRequestMeetProvision: true,
          isCalendarOwner: true,
        })}
        primaryActionAvailable={false}
        isOpeningMeet={false}
        onStartMeeting={vi.fn()}
        onContextChanged={onContextChanged}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'צור Google Meet' }))
    await waitFor(() => {
      expect(requestMeetProvisionMock).toHaveBeenCalledWith('m1')
    })
    expect(onContextChanged).toHaveBeenCalled()
  })

  it('hides owner CTAs for non-owners', () => {
    render(
      <MeetingMeetProvisionPanel
        meetingId="m1"
        context={onlineContext({
          meetProvisionStatus: 'failed',
          ownerGoogleConnected: true,
          ownerGoogleConnectionStatus: 'connected',
          canRequestMeetProvision: false,
          isCalendarOwner: false,
        })}
        primaryActionAvailable={false}
        isOpeningMeet={false}
        onStartMeeting={vi.fn()}
        onContextChanged={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'נסה שוב' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'חבר חשבון Google' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'צור Google Meet' })).not.toBeInTheDocument()
  })

  it('replaces stale connected liveContext with Connect Google when status is reauthorization_required', async () => {
    getGoogleConnectionStatusMock.mockResolvedValue({
      ok: true,
      connected: false,
      connectionStatus: 'reauthorization_required',
      email: 'owner@school.example',
    })

    render(
      <MeetingMeetProvisionPanel
        meetingId="m1"
        context={onlineContext({
          meetProvisionStatus: 'google_not_connected',
          meetProvisionError: null,
          ownerGoogleConnected: true,
          ownerGoogleConnectionStatus: 'connected',
          canRequestMeetProvision: true,
          isCalendarOwner: true,
        })}
        primaryActionAvailable={false}
        isOpeningMeet={false}
        onStartMeeting={vi.fn()}
        onContextChanged={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'צור Google Meet' })).toBeInTheDocument()

    await waitFor(() => {
      expect(getGoogleConnectionStatusMock).toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'חבר חשבון Google' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'צור Google Meet' })).not.toBeInTheDocument()
    expect(screen.getByTestId('meet-provision-status')).toHaveTextContent(
      'נדרש חיבור מחדש לחשבון Google',
    )
    expect(startGoogleOAuthMock).not.toHaveBeenCalled()
    expect(requestMeetProvisionMock).not.toHaveBeenCalled()
  })

  it('keeps GOOGLE_NOT_CONNECTED feedback visible and switches to Connect Google', async () => {
    const onContextChanged = vi.fn()
    requestMeetProvisionMock.mockResolvedValue({
      ok: true,
      meetProvisionStatus: 'google_not_connected',
      enqueued: false,
      googleConnected: false,
      requestKey: 'adoflow-m1-slot',
      code: 'GOOGLE_NOT_CONNECTED',
    })

    const { rerender } = render(
      <MeetingMeetProvisionPanel
        meetingId="m1"
        context={onlineContext({
          meetProvisionStatus: 'google_not_connected',
          ownerGoogleConnected: true,
          ownerGoogleConnectionStatus: 'connected',
          canRequestMeetProvision: true,
          isCalendarOwner: true,
        })}
        primaryActionAvailable={false}
        isOpeningMeet={false}
        onStartMeeting={vi.fn()}
        onContextChanged={onContextChanged}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'צור Google Meet' }))

    await waitFor(() => {
      expect(requestMeetProvisionMock).toHaveBeenCalledWith('m1')
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'יש לחבר חשבון Google לפני יצירת הקישור.',
    )
    expect(screen.getByRole('button', { name: 'חבר חשבון Google' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'צור Google Meet' })).not.toBeInTheDocument()
    expect(onContextChanged).toHaveBeenCalled()

    // Soft-refreshed live context arrives while the panel stays mounted.
    rerender(
      <MeetingMeetProvisionPanel
        meetingId="m1"
        context={onlineContext({
          meetProvisionStatus: 'google_not_connected',
          meetProvisionError: 'REAUTHORIZATION_REQUIRED',
          ownerGoogleConnected: false,
          ownerGoogleConnectionStatus: 'reauthorization_required',
          canRequestMeetProvision: true,
          isCalendarOwner: true,
        })}
        primaryActionAvailable={false}
        isOpeningMeet={false}
        onStartMeeting={vi.fn()}
        onContextChanged={onContextChanged}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'יש לחבר חשבון Google לפני יצירת הקישור.',
    )
    expect(screen.getByRole('button', { name: 'חבר חשבון Google' })).toBeInTheDocument()
    expect(screen.getByTestId('meet-provision-status')).toHaveTextContent(
      'נדרש חיבור מחדש לחשבון Google',
    )
  })
})
