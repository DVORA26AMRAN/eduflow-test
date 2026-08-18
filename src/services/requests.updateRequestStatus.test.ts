import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  rpcMock,
  usersSingleMock,
  requestsEqMock,
  requestsUpdateMock,
  fromMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  rpcMock: vi.fn(),
  usersSingleMock: vi.fn(),
  requestsEqMock: vi.fn(),
  requestsUpdateMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
    rpc: rpcMock,
    from: fromMock,
  },
}))

import { updateRequestStatus } from './requests'

function mockCallerRole(role: string) {
  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: 'user-1' } } },
    error: null,
  })
  usersSingleMock.mockResolvedValue({
    data: { primary_role: role },
    error: null,
  })
}

describe('updateRequestStatus role routing', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    rpcMock.mockReset()
    usersSingleMock.mockReset()
    requestsEqMock.mockReset()
    requestsUpdateMock.mockReset()
    fromMock.mockReset()

    fromMock.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: usersSingleMock,
            })),
          })),
        }
      }

      if (table === 'requests') {
        return {
          update: requestsUpdateMock,
        }
      }

      throw new Error(`unexpected table ${table}`)
    })

    requestsUpdateMock.mockReturnValue({
      eq: requestsEqMock,
    })
    requestsEqMock.mockResolvedValue({ error: null })
    rpcMock.mockResolvedValue({ data: { ok: true, status: 'in_progress' }, error: null })
  })

  it('calls update_request_status RPC for Manager and does not table-update', async () => {
    mockCallerRole('institution_manager')

    await expect(updateRequestStatus('req-1', 'in_progress')).resolves.toEqual({ ok: true })

    expect(rpcMock).toHaveBeenCalledWith('update_request_status', {
      p_request_id: 'req-1',
      p_status: 'in_progress',
    })
    expect(requestsUpdateMock).not.toHaveBeenCalled()
  })

  it('calls update_request_status RPC for Deputy and does not table-update', async () => {
    mockCallerRole('deputy')

    await expect(updateRequestStatus('req-1', 'completed')).resolves.toEqual({ ok: true })

    expect(rpcMock).toHaveBeenCalledWith('update_request_status', {
      p_request_id: 'req-1',
      p_status: 'completed',
    })
    expect(requestsUpdateMock).not.toHaveBeenCalled()
  })

  it('keeps Secretary on the existing requests table UPDATE path', async () => {
    mockCallerRole('secretary')

    await expect(updateRequestStatus('req-1', 'rejected')).resolves.toEqual({ ok: true })

    expect(rpcMock).not.toHaveBeenCalled()
    expect(requestsUpdateMock).toHaveBeenCalledWith({ status: 'rejected' })
    expect(requestsEqMock).toHaveBeenCalledWith('id', 'req-1')
  })

  it('does not send Teacher or Platform Admin through the operator RPC or table UPDATE', async () => {
    mockCallerRole('teacher')
    await expect(updateRequestStatus('req-1', 'new')).resolves.toEqual({
      ok: false,
      errorMessage: 'עדכון סטטוס הבקשה נכשל.',
    })

    mockCallerRole('platform_admin')
    await expect(updateRequestStatus('req-1', 'new')).resolves.toEqual({
      ok: false,
      errorMessage: 'עדכון סטטוס הבקשה נכשל.',
    })

    expect(rpcMock).not.toHaveBeenCalled()
    expect(requestsUpdateMock).not.toHaveBeenCalled()
  })

  it('does not pass extra request fields to the operator RPC', async () => {
    mockCallerRole('deputy')

    await updateRequestStatus('req-1', 'in_progress')

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock.mock.calls[0]?.[1]).toEqual({
      p_request_id: 'req-1',
      p_status: 'in_progress',
    })
  })
})
