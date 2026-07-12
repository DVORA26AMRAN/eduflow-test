import type { RequestMessage } from '../../types/requestMessage'
import {
  formatRequestMessageDate,
  formatRequestMessageTime,
  getRequestMessageAuthorRoleLabel,
} from '../../utils/requestMessageDisplay'

type RequestMessageItemProps = {
  message: RequestMessage
}

export function RequestMessageItem({ message }: RequestMessageItemProps) {
  const authorName = message.author_full_name ?? 'משתמש'
  const authorRoleLabel = getRequestMessageAuthorRoleLabel(message.author_primary_role)
  const authorLabel = authorRoleLabel ? `${authorName} · ${authorRoleLabel}` : authorName

  return (
    <article className="request-conversation__message" aria-label={`הודעה מ-${authorName}`}>
      <header className="request-conversation__message-header">
        <p className="request-conversation__message-author">{authorLabel}</p>
        <p className="request-conversation__message-time">
          <time dateTime={message.created_at}>{formatRequestMessageDate(message.created_at)}</time>
          <span className="request-conversation__message-time-separator" aria-hidden="true">
            {' '}
          </span>
          <time dateTime={message.created_at}>{formatRequestMessageTime(message.created_at)}</time>
        </p>
      </header>
      <p className="request-conversation__message-body">{message.message}</p>
    </article>
  )
}
