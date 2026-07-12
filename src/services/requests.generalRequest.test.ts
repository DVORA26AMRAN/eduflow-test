import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('createTeacherRequest general_request insert', () => {
  const requestsSource = readFileSync(
    resolve(process.cwd(), 'src/services/requests.ts'),
    'utf8',
  )

  it('persists recipient_role and request_payload on insert', () => {
    expect(requestsSource).toMatch(
      /createTeacherRequest[\s\S]*recipient_role: input\.recipientRole/,
    )
    expect(requestsSource).toMatch(
      /createTeacherRequest[\s\S]*request_payload: input\.requestPayload/,
    )
  })

  it('loads recipient_role and request_payload for teacher history', () => {
    expect(requestsSource).toMatch(
      /loadTeacherRequests[\s\S]*recipient_role, request_payload/,
    )
  })
})
