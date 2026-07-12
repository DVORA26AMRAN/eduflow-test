import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestDetailsConversationSection } from './RequestDetailsConversationSection'

const loadRequestMessages = vi.fn()
const createRequestMessage = vi.fn()

vi.mock('../../services/requestMessages', () => ({
  loadRequestMessages: (...args: unknown[]) => loadRequestMessages(...args),
  createRequestMessage: (...args: unknown[]) => createRequestMessage(...args),
  subscribeToRequestMessages: () => ({}),
  unsubscribeFromRequestMessages: vi.fn(),
  appendRequestMessageIfNew: (current: unknown[], incoming: unknown) => [...current, incoming],
}))

const message = {
  id: 'msg-1',
  request_id: 'req-1',
  author_user_id: 'user-1',
  message: 'אשמח לעדכון',
  created_at: '2026-07-12T11:10:00.000Z',
  author_full_name: 'רונית',
  author_primary_role: 'teacher',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  loadRequestMessages.mockResolvedValue({ ok: true, messages: [message] })
  createRequestMessage.mockResolvedValue({
    ok: true,
    message: {
      ...message,
      id: 'msg-2',
      message: 'קיבלתי',
      author_full_name: 'מזכירה',
      author_primary_role: 'secretary',
      created_at: '2026-07-12T12:02:00.000Z',
    },
  })
})

describe('RequestDetailsConversationSection', () => {
  it('renders conversation messages and send controls', async () => {
    render(
      <RequestDetailsConversationSection
        requestId="req-1"
        isActive
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('אשמח לעדכון')).toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { name: 'שיחה' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שלח' })).toBeInTheDocument()
    expect(screen.getByText(/רונית/)).toBeInTheDocument()
  })

  it('rolls back optimistic UI when send fails', async () => {
    const user = userEvent.setup()
    createRequestMessage.mockResolvedValueOnce({
      ok: false,
      errorMessage: 'שליחת ההודעה נכשלה.',
    })

    render(
      <RequestDetailsConversationSection
        requestId="req-1"
        isActive
      />,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('הודעה חדשה')).toBeEnabled()
    })

    await user.type(screen.getByLabelText('הודעה חדשה'), 'הודעה חדשה')
    await user.click(screen.getByRole('button', { name: 'שלח' }))

    expect(await screen.findByText('שליחת ההודעה נכשלה.')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: /הודעה מ-אני/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('הודעה חדשה')).toHaveValue('הודעה חדשה')
  })

  it('marks conversation as opened for unread handling', async () => {
    const onConversationOpened = vi.fn()

    render(
      <RequestDetailsConversationSection
        requestId="req-1"
        isActive
        onConversationOpened={onConversationOpened}
      />,
    )

    await waitFor(() => {
      expect(onConversationOpened).toHaveBeenCalledTimes(1)
    })
  })
})
