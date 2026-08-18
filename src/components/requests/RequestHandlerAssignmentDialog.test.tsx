import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loadEligibleRequestHandlersMock,
  transferRequestHandlerMock,
  releaseRequestHandlerMock,
} = vi.hoisted(() => ({
  loadEligibleRequestHandlersMock: vi.fn(),
  transferRequestHandlerMock: vi.fn(),
  releaseRequestHandlerMock: vi.fn(),
}))

vi.mock('../../services/requestOwnership', () => ({
  loadEligibleRequestHandlers: loadEligibleRequestHandlersMock,
  transferRequestHandler: transferRequestHandlerMock,
  releaseRequestHandler: releaseRequestHandlerMock,
}))

import { RequestHandlerAssignmentDialog } from './RequestHandlerAssignmentDialog'

afterEach(() => {
  cleanup()
})

const handlers = [
  {
    id: 'sec-2',
    fullName: 'מזכירה שנייה',
    primaryRole: 'secretary' as const,
    status: 'active' as const,
  },
]

const baseProps = {
  isOpen: true,
  requestId: 'req-1',
  requestType: 'absence' as const,
  recipientRole: null,
  status: 'in_progress' as const,
  handledByUserId: 'sec-1',
  handledByFullName: 'מזכירה ראשית',
  handledByPrimaryRole: 'secretary' as const,
  actorUserId: 'sec-1',
  actorRole: 'secretary' as const,
  isBusy: false,
  onClose: vi.fn(),
  onTransferred: vi.fn(),
  onReleased: vi.fn(),
  onError: vi.fn(),
}

describe('RequestHandlerAssignmentDialog', () => {
  beforeEach(() => {
    loadEligibleRequestHandlersMock.mockReset()
    transferRequestHandlerMock.mockReset()
    releaseRequestHandlerMock.mockReset()
    loadEligibleRequestHandlersMock.mockResolvedValue({ ok: true, handlers })
    transferRequestHandlerMock.mockResolvedValue({
      ok: true,
      handledByUserId: 'sec-2',
      status: 'in_progress',
    })
    releaseRequestHandlerMock.mockResolvedValue({
      ok: true,
      handledByUserId: null,
      status: 'new',
    })
  })

  it('10. current handler can open transfer dialog', async () => {
    render(<RequestHandlerAssignmentDialog {...baseProps} />)
    expect(screen.getByText('בטיפול של מזכירה ראשית · מזכירה')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'העברה לטיפול' })).toBeEnabled()
    })
  })

  it('11. Manager can transfer another handler request', async () => {
    render(
      <RequestHandlerAssignmentDialog
        {...baseProps}
        actorUserId="mgr-1"
        actorRole="institution_manager"
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'העברה לטיפול' })).toBeEnabled()
    })
  })

  it('12. Deputy cannot transfer another handler request', () => {
    render(
      <RequestHandlerAssignmentDialog
        {...baseProps}
        actorUserId="dep-1"
        actorRole="deputy"
      />,
    )
    expect(screen.queryByRole('button', { name: 'העברה לטיפול' })).not.toBeInTheDocument()
    expect(
      screen.getByText('רק המטפלת הנוכחית או המנהלת יכולות להעביר או לשחרר טיפול.'),
    ).toBeInTheDocument()
  })

  it('13. Secretary cannot transfer another handler request', () => {
    render(
      <RequestHandlerAssignmentDialog
        {...baseProps}
        actorUserId="sec-9"
        actorRole="secretary"
      />,
    )
    expect(screen.queryByRole('button', { name: 'העברה לטיפול' })).not.toBeInTheDocument()
  })

  it('20. transfer submits transfer_request_handler', async () => {
    const onTransferred = vi.fn()
    render(<RequestHandlerAssignmentDialog {...baseProps} onTransferred={onTransferred} />)
    const submit = await screen.findByRole('button', { name: 'העברה לטיפול' })
    fireEvent.click(submit)
    await waitFor(() => {
      expect(transferRequestHandlerMock).toHaveBeenCalledWith('req-1', 'sec-2')
    })
  })

  it('21. current handler can release', async () => {
    render(<RequestHandlerAssignmentDialog {...baseProps} />)
    const release = await screen.findByRole('button', { name: 'שחרור טיפול' })
    fireEvent.click(release)
    await waitFor(() => {
      expect(releaseRequestHandlerMock).toHaveBeenCalledWith('req-1')
    })
  })

  it('22. completed/rejected do not show release', async () => {
    render(<RequestHandlerAssignmentDialog {...baseProps} status="completed" />)
    await waitFor(() => {
      expect(loadEligibleRequestHandlersMock).toHaveBeenCalled()
    })
    expect(screen.queryByRole('button', { name: 'שחרור טיפול' })).not.toBeInTheDocument()
  })
})
