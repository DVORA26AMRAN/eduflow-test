import { CONVERSATION_UNREAD_BADGE_LABEL } from '../../types/requestMessage'

type RequestConversationRowIndicatorProps = {
  hasConversation: boolean
  hasUnreadConversation: boolean
  badgeClassName?: string
}

export function RequestConversationRowIndicator({
  hasConversation,
  hasUnreadConversation,
  badgeClassName = 'request-conversation-row-indicator',
}: RequestConversationRowIndicatorProps) {
  if (!hasConversation) {
    return null
  }

  if (hasUnreadConversation) {
    return (
      <span
        className={`${badgeClassName} ${badgeClassName}--unread`}
        aria-label={`${CONVERSATION_UNREAD_BADGE_LABEL} בשיחה`}
      >
        <span className="request-conversation-row-indicator__icon" aria-hidden="true">
          💬
        </span>
        {CONVERSATION_UNREAD_BADGE_LABEL}
      </span>
    )
  }

  return (
    <span className={`${badgeClassName} ${badgeClassName}--neutral`} aria-label="יש שיחה בבקשה">
      <span className="request-conversation-row-indicator__icon" aria-hidden="true">
        💬
      </span>
    </span>
  )
}
