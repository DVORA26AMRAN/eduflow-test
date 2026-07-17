import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}))

import { loadStaffDirectory } from './staffDirectory'

describe('loadStaffDirectory', () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  it('executes get_staff_directory through the Supabase RPC client', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })

    const result = await loadStaffDirectory()

    expect(rpcMock).toHaveBeenCalledWith('get_staff_directory')
    expect(result).toEqual({ ok: true, members: [] })
  })

  it('contains exceptions thrown before an RPC response is received', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    rpcMock.mockRejectedValue(new Error('fetch failed'))

    await expect(loadStaffDirectory()).resolves.toEqual({
      ok: false,
      errorMessage: 'לא ניתן לטעון את ספר העובדים.',
    })

    consoleError.mockRestore()
  })
})
