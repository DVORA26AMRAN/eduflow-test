import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RequestConversationRowIndicator } from './RequestConversationRowIndicator'

afterEach(() => {
  cleanup()
})

describe('RequestConversationRowIndicator', () => {
  it('renders nothing when the request has no conversation', () => {
    const { container } = render(
      <RequestConversationRowIndicator hasConversation={false} hasUnreadConversation={false} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the unread conversation badge with visible text', () => {
    render(
      <RequestConversationRowIndicator hasConversation hasUnreadConversation />,
    )

    expect(screen.getByText('הודעה חדשה')).toBeInTheDocument()
    expect(screen.getByLabelText('הודעה חדשה בשיחה')).toBeInTheDocument()
  })

  it('shows only the neutral conversation icon when messages are read', () => {
    render(
      <RequestConversationRowIndicator hasConversation hasUnreadConversation={false} />,
    )

    expect(screen.getByLabelText('יש שיחה בבקשה')).toBeInTheDocument()
    expect(screen.queryByText('הודעה חדשה')).not.toBeInTheDocument()
  })

  it('does not show unread styling when only read conversation exists', () => {
    const { container } = render(
      <RequestConversationRowIndicator hasConversation hasUnreadConversation={false} />,
    )

    expect(container.querySelector('.request-conversation-row-indicator--unread')).toBeNull()
    expect(container.querySelector('.request-conversation-row-indicator--neutral')).toBeTruthy()
  })
})
