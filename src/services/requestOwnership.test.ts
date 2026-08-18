import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}))

import {
  claimRequest,
  loadEligibleRequestHandlers,
  releaseRequestHandler,
  transferRequestHandler,
} from './requestOwnership'
import { REQUEST_OWNERSHIP_MESSAGES } from '../types/requestOwnership'

describe('request ownership service RPCs', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
  })

  it('4. claim calls claim_request and returns handler plus in_progress', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, handled_by_user_id: 'user-1', status: 'in_progress' },
      error: null,
    })

    await expect(claimRequest('req-1')).resolves.toEqual({
      ok: true,
      handledByUserId: 'user-1',
      status: 'in_progress',
      unchanged: false,
    })
    expect(rpcMock).toHaveBeenCalledWith('claim_request', { p_request_id: 'req-1' })
  })

  it('20. transfer calls transfer_request_handler', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, handled_by_user_id: 'user-2', status: 'in_progress' },
      error: null,
    })

    await expect(transferRequestHandler('req-1', 'user-2')).resolves.toMatchObject({
      ok: true,
      handledByUserId: 'user-2',
    })
    expect(rpcMock).toHaveBeenCalledWith('transfer_request_handler', {
      p_request_id: 'req-1',
      p_target_user_id: 'user-2',
    })
  })

  it('21. release calls release_request_handler', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, handled_by_user_id: null, status: 'new' },
      error: null,
    })

    await expect(releaseRequestHandler('req-1')).resolves.toEqual({
      ok: true,
      handledByUserId: null,
      status: 'new',
    })
    expect(rpcMock).toHaveBeenCalledWith('release_request_handler', { p_request_id: 'req-1' })
  })

  it('23. REQUEST_ALREADY_CLAIMED maps to the calm Hebrew message', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: false, error: 'REQUEST_ALREADY_CLAIMED' },
      error: null,
    })

    await expect(claimRequest('req-1')).resolves.toEqual({
      ok: false,
      errorCode: 'REQUEST_ALREADY_CLAIMED',
      errorMessage: REQUEST_OWNERSHIP_MESSAGES.REQUEST_ALREADY_CLAIMED,
    })
  })

  it('loads eligible handlers from users fields and does not use get_staff_directory', async () => {
    const query = {
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'mgr-1',
            full_name: 'מנהלת',
            primary_role: 'institution_manager',
            status: 'active',
            institution_id: 'inst-1',
          },
        ],
        error: null,
      }),
    }
    fromMock.mockReturnValue({
      select: vi.fn(() => query),
    })

    const result = await loadEligibleRequestHandlers({
      requestType: 'absence',
      institutionId: 'inst-1',
    })

    expect(result).toEqual({
      ok: true,
      handlers: [
        {
          id: 'mgr-1',
          fullName: 'מנהלת',
          primaryRole: 'institution_manager',
          status: 'active',
        },
      ],
    })
    expect(fromMock).toHaveBeenCalledWith('users')
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
