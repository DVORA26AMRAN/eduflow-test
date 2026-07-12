import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadTeacherRequestNotificationContexts } from './teacherNotificationRequests'

const inMock = vi.fn()

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: inMock,
      })),
    })),
  },
}))

describe('loadTeacherRequestNotificationContexts', () => {
  beforeEach(() => {
    inMock.mockReset()
  })

  it('loads all request contexts in one batched query', async () => {
    inMock.mockResolvedValue({
      data: [
        {
          id: 'req-1',
          request_type: 'absence',
          description: 'היעדרות',
          status: 'completed',
          archived_at: null,
          request_payload: null,
        },
        {
          id: 'req-2',
          request_type: 'general_request',
          description: 'נושא כללי',
          status: 'in_progress',
          archived_at: '2026-07-02T10:00:00.000Z',
          request_payload: { message: 'הודעה' },
        },
      ],
      error: null,
    })

    const result = await loadTeacherRequestNotificationContexts(['req-1', 'req-2'])

    expect(inMock).toHaveBeenCalledTimes(1)
    expect(inMock).toHaveBeenCalledWith('id', ['req-1', 'req-2'])
    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.contexts.get('req-1')?.requestType).toBe('absence')
      expect(result.contexts.get('req-2')?.archivedAt).toBe('2026-07-02T10:00:00.000Z')
    }
  })

  it('returns an empty map without querying when there are no ids', async () => {
    const result = await loadTeacherRequestNotificationContexts([])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.contexts.size).toBe(0)
    }
    expect(inMock).not.toHaveBeenCalled()
  })
})
