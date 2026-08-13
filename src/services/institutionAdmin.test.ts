import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}))

import {
  createInstitutionAsPlatformAdmin,
  loadInstitutionsForPlatformAdmin,
  updateInstitutionAsPlatformAdmin,
} from './institutionAdmin'

const row = {
  id: 'inst-1',
  name: 'בית ספר א',
  institution_code: '1001',
  address: 'רחוב 1',
  city: 'חיפה',
  phone: '04-1111111',
  email: 'a@school.com',
  logo_url: null,
  logo_updated_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

describe('institutionAdmin service', () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  it('lists institutions through platform_admin_list_institutions', async () => {
    rpcMock.mockResolvedValue({ data: [row], error: null })

    const result = await loadInstitutionsForPlatformAdmin()

    expect(rpcMock).toHaveBeenCalledWith('platform_admin_list_institutions')
    expect(result).toEqual({
      ok: true,
      institutions: [
        expect.objectContaining({
          id: 'inst-1',
          name: 'בית ספר א',
          institutionCode: '1001',
          city: 'חיפה',
        }),
      ],
    })
  })

  it('maps permission denied on create for non-platform-admin', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Permission denied.' },
    })

    const result = await createInstitutionAsPlatformAdmin({
      name: 'בית ספר',
      institutionCode: '2002',
      address: 'כתובת',
      city: 'עיר',
      phone: '050-1111111',
      email: 'new@school.com',
    })

    expect(rpcMock).toHaveBeenCalledWith(
      'platform_admin_create_institution',
      expect.objectContaining({
        p_institution_code: '2002',
      }),
    )
    expect(result).toEqual({
      ok: false,
      errorMessage: 'אין הרשאה לבצע פעולה זו.',
    })
  })

  it('rejects duplicate institution codes from the server', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Institution code already exists.', code: '23505' },
    })

    const result = await createInstitutionAsPlatformAdmin({
      name: 'בית ספר',
      institutionCode: '2002',
      address: 'כתובת',
      city: 'עיר',
      phone: '050-1111111',
      email: 'new@school.com',
    })

    expect(result).toEqual({
      ok: false,
      errorMessage: 'סמל המוסד כבר קיים במערכת.',
    })
  })

  it('validates required fields before calling create RPC', async () => {
    const result = await createInstitutionAsPlatformAdmin({
      name: '',
      institutionCode: '2002',
      address: 'כתובת',
      city: 'עיר',
      phone: '050-1111111',
      email: 'new@school.com',
    })

    expect(rpcMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('updates institution metadata without changing id', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, institution_id: 'inst-1' },
      error: null,
    })

    const result = await updateInstitutionAsPlatformAdmin('inst-1', {
      name: 'בית ספר מעודכן',
      institutionCode: '1001',
      address: 'רחוב 2',
      city: 'חיפה',
      phone: '04-2222222',
      email: 'b@school.com',
    })

    expect(rpcMock).toHaveBeenCalledWith(
      'platform_admin_update_institution',
      expect.objectContaining({
        p_institution_id: 'inst-1',
        p_name: 'בית ספר מעודכן',
      }),
    )
    expect(result).toEqual({ ok: true, institutionId: 'inst-1' })
  })

  it('fails update when server returns a different institution id', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, institution_id: 'other-id' },
      error: null,
    })

    const result = await updateInstitutionAsPlatformAdmin('inst-1', {
      name: 'בית ספר מעודכן',
      institutionCode: '1001',
      address: 'רחוב 2',
      city: 'חיפה',
      phone: '04-2222222',
      email: 'b@school.com',
    })

    expect(result.ok).toBe(false)
  })
})
