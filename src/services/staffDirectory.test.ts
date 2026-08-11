import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}))

import { loadStaffDirectory, loadStaffMemberDetails } from './staffDirectory'

const validRow = {
  id: 'teacher-1',
  full_name: 'דני כהן',
  email: 'danny@school.com',
  phone: '050-1111111',
  job_title: 'מחנך',
  weekly_hours: 30,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
}

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

  it('parses a staff row with a string email', async () => {
    rpcMock.mockResolvedValue({ data: [validRow], error: null })

    await expect(loadStaffDirectory()).resolves.toEqual({
      ok: true,
      members: [
        {
          id: 'teacher-1',
          fullName: 'דני כהן',
          email: 'danny@school.com',
          phone: '050-1111111',
          jobTitle: 'מחנך',
          weeklyHours: 30,
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  })

  it('parses a staff row with a null email', async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...validRow, email: null }],
      error: null,
    })

    const result = await loadStaffDirectory()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.members).toHaveLength(1)
      expect(result.members[0]?.email).toBeNull()
    }
  })

  it('loads multiple rows with null emails without failing the whole list', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { ...validRow, id: 't1', email: null },
        { ...validRow, id: 't2', email: 'yael@school.com', full_name: 'יעל לוי' },
        { ...validRow, id: 't3', email: null, full_name: 'נועה לוי' },
      ],
      error: null,
    })

    const result = await loadStaffDirectory()
    expect(result).toEqual({
      ok: true,
      members: [
        expect.objectContaining({ id: 't1', email: null }),
        expect.objectContaining({ id: 't2', email: 'yael@school.com' }),
        expect.objectContaining({ id: 't3', email: null }),
      ],
    })
  })

  it('still rejects rows missing required structural fields', async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...validRow, id: 1 }],
      error: null,
    })

    await expect(loadStaffDirectory()).resolves.toEqual({
      ok: false,
      errorMessage: 'לא ניתן לטעון את ספר העובדים.',
    })
  })

  it.each(['full_name', 'status', 'created_at'] as const)(
    'still rejects a row with a malformed %s',
    async (field) => {
      rpcMock.mockResolvedValue({
        data: [{ ...validRow, [field]: null }],
        error: null,
      })

      await expect(loadStaffDirectory()).resolves.toEqual({
        ok: false,
        errorMessage: 'לא ניתן לטעון את ספר העובדים.',
      })
    },
  )

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

describe('loadStaffMemberDetails', () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  it('parses details when email is null', async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...validRow, email: null, national_id: null }],
      error: null,
    })

    await expect(loadStaffMemberDetails('teacher-1')).resolves.toEqual({
      ok: true,
      member: expect.objectContaining({
        id: 'teacher-1',
        email: null,
        nationalId: null,
      }),
    })
  })
})
