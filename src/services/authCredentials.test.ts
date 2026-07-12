import { describe, expect, it } from 'vitest'
import { buildSignInCredentials } from './authCredentials'

describe('buildSignInCredentials', () => {
  it('does not include remembered-email preferences because the current API contract does not support them', () => {
    const credentials = buildSignInCredentials('user@school.edu', 'secret-password')

    expect(credentials).toEqual({
      email: 'user@school.edu',
      password: 'secret-password',
    })
    expect(credentials).not.toHaveProperty('rememberMe')
  })
})
