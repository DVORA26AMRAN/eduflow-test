import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getGoogleConnectionStatus,
  googleOAuthUsesViteSecrets,
} from '../services/googleOAuth'

const rpc = vi.fn()
const invoke = vi.fn()

vi.mock('../services/supabase', () => ({
  supabaseUrl: 'https://example.supabase.co',
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: {
      invoke: (...args: unknown[]) => invoke(...args),
    },
  },
}))

describe('Google connection status client contract', () => {
  beforeEach(() => {
    rpc.mockReset()
    invoke.mockReset()
  })

  it('maps status RPC to connected/email only (no tokens)', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        connected: true,
        connection_status: 'connected',
        email: 'owner@school.example',
        refresh_token: 'should-be-ignored-if-present',
      },
      error: null,
    })

    const result = await getGoogleConnectionStatus()
    expect(result).toEqual({
      ok: true,
      connected: true,
      connectionStatus: 'connected',
      email: 'owner@school.example',
    })
    expect(JSON.stringify(result)).not.toMatch(/refresh|cipher|nonce|token/i)
  })

  it('maps reauthorization_required without exposing credentials', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        connected: false,
        connection_status: 'reauthorization_required',
        email: 'owner@school.example',
      },
      error: null,
    })

    const result = await getGoogleConnectionStatus()
    expect(result).toEqual({
      ok: true,
      connected: false,
      connectionStatus: 'reauthorization_required',
      email: 'owner@school.example',
    })
  })

  it('does not place Google secrets in VITE env surface', () => {
    expect(googleOAuthUsesViteSecrets()).toBe(false)
  })
})
