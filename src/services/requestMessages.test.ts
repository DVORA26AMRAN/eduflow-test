import { describe, expect, it } from 'vitest'
import { appendRequestMessageIfNew } from './requestMessages'
import type { RequestMessage } from '../types/requestMessage'

const baseMessage = (overrides: Partial<RequestMessage> = {}): RequestMessage => ({
  id: 'msg-1',
  request_id: 'req-1',
  author_user_id: 'user-1',
  message: 'שלום',
  created_at: '2026-07-01T10:00:00.000Z',
  author_full_name: 'רונית',
  author_primary_role: 'teacher',
  ...overrides,
})

describe('appendRequestMessageIfNew', () => {
  it('keeps chronological order when appending a new message', () => {
    const existing = [
      baseMessage({ id: 'msg-1', created_at: '2026-07-01T10:00:00.000Z' }),
      baseMessage({ id: 'msg-2', created_at: '2026-07-01T11:00:00.000Z' }),
    ]

    const appended = appendRequestMessageIfNew(
      existing,
      baseMessage({ id: 'msg-3', created_at: '2026-07-01T12:00:00.000Z', message: 'עדכון' }),
    )

    expect(appended.map((message) => message.id)).toEqual(['msg-1', 'msg-2', 'msg-3'])
  })

  it('does not duplicate messages already present from realtime', () => {
    const existing = [baseMessage({ id: 'msg-1' })]

    const appended = appendRequestMessageIfNew(existing, baseMessage({ id: 'msg-1', message: 'כפול' }))

    expect(appended).toHaveLength(1)
    expect(appended[0]?.message).toBe('שלום')
  })
})
