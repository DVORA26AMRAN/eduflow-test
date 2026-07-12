import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { RequestMessage } from '../../types/requestMessage'
import {
  CONVERSATION_SECTION_TITLE,
  MESSAGE_EMPTY_LABEL,
  MESSAGE_INPUT_PLACEHOLDER,
  MESSAGE_LOADING_LABEL,
  MESSAGE_SEND_BUTTON_LABEL,
} from '../../types/requestMessage'
import {
  appendRequestMessageIfNew,
  createRequestMessage,
  loadRequestMessages,
  subscribeToRequestMessages,
  unsubscribeFromRequestMessages,
} from '../../services/requestMessages'
import { isConversationListAtBottom } from '../../utils/requestMessageDisplay'
import { RequestMessageItem } from './RequestMessageItem'
import './RequestDetailsConversationSection.css'

type RequestDetailsConversationSectionProps = {
  requestId: string
  isActive: boolean
  onConversationOpened?: () => void
}

export function RequestDetailsConversationSection({
  requestId,
  isActive,
  onConversationOpened,
}: RequestDetailsConversationSectionProps) {
  const [messages, setMessages] = useState<RequestMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const hasMarkedOpenedRef = useRef(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const listElement = listRef.current
    if (!listElement) {
      return
    }

    if (typeof listElement.scrollTo === 'function') {
      listElement.scrollTo({
        top: listElement.scrollHeight,
        behavior,
      })
    } else {
      listElement.scrollTop = listElement.scrollHeight
    }

    isAtBottomRef.current = true
  }, [])

  const scrollToBottomIfNeeded = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (!isAtBottomRef.current) {
        return
      }

      scrollToBottom(behavior)
    },
    [scrollToBottom],
  )

  const fetchMessages = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadRequestMessages(requestId)

    if (!result.ok) {
      setMessages([])
      setLoadError(result.errorMessage)
    } else {
      setMessages(result.messages)
    }

    setIsLoading(false)
  }, [requestId])

  useEffect(() => {
    hasMarkedOpenedRef.current = false
  }, [requestId])

  useEffect(() => {
    if (!isActive) {
      hasMarkedOpenedRef.current = false
      return
    }

    queueMicrotask(() => {
      setDraftMessage('')
      setSendError('')
      void fetchMessages()
    })
  }, [isActive, fetchMessages])

  useEffect(() => {
    if (!isActive || isLoading) {
      return
    }

    scrollToBottom('auto')
  }, [isActive, isLoading, requestId, scrollToBottom])

  useEffect(() => {
    if (!isActive || isLoading || hasMarkedOpenedRef.current) {
      return
    }

    hasMarkedOpenedRef.current = true
    onConversationOpened?.()
  }, [isActive, isLoading, onConversationOpened])

  useEffect(() => {
    if (!isActive) {
      return
    }

    let channel: RealtimeChannel | null = null

    const subscribedChannel = subscribeToRequestMessages(requestId, (incomingMessage) => {
      setMessages((currentMessages) => {
        const nextMessages = appendRequestMessageIfNew(currentMessages, incomingMessage)
        return nextMessages
      })
      requestAnimationFrame(() => {
        scrollToBottomIfNeeded('smooth')
      })
    })

    channel = subscribedChannel

    return () => {
      if (channel) {
        void unsubscribeFromRequestMessages(channel)
      }
    }
  }, [isActive, requestId, scrollToBottomIfNeeded])

  function handleListScroll() {
    const listElement = listRef.current
    if (!listElement) {
      return
    }

    isAtBottomRef.current = isConversationListAtBottom(listElement)
  }

  async function handleSendMessage() {
    const trimmedMessage = draftMessage.trim()
    if (!trimmedMessage || isSending) {
      return
    }

    setIsSending(true)
    setSendError('')

    const optimisticId = `optimistic-${crypto.randomUUID()}`
    const optimisticMessage: RequestMessage = {
      id: optimisticId,
      request_id: requestId,
      author_user_id: 'current-user',
      message: trimmedMessage,
      created_at: new Date().toISOString(),
      author_full_name: 'אני',
      author_primary_role: null,
    }

    setMessages((currentMessages) => [...currentMessages, optimisticMessage])
    setDraftMessage('')
    requestAnimationFrame(() => {
      scrollToBottom('smooth')
    })

    const result = await createRequestMessage({
      requestId,
      message: trimmedMessage,
    })

    setIsSending(false)

    if (!result.ok) {
      setMessages((currentMessages) =>
        currentMessages.filter((message) => message.id !== optimisticId),
      )
      setDraftMessage(trimmedMessage)
      setSendError(result.errorMessage)
      return
    }

    setMessages((currentMessages) => {
      const withoutOptimistic = currentMessages.filter((message) => message.id !== optimisticId)
      return appendRequestMessageIfNew(withoutOptimistic, result.message)
    })
    requestAnimationFrame(() => {
      scrollToBottomIfNeeded('smooth')
    })
  }

  return (
    <section className="request-details__section request-conversation" aria-label={CONVERSATION_SECTION_TITLE}>
      <h3 className="request-details__section-title">{CONVERSATION_SECTION_TITLE}</h3>

      {isLoading && <p className="ds-form-message">{MESSAGE_LOADING_LABEL}</p>}

      {!isLoading && loadError && (
        <p className="ds-form-message ds-form-message--error">{loadError}</p>
      )}

      {!isLoading && !loadError && (
        <>
          <div
            ref={listRef}
            className="request-conversation__messages"
            onScroll={handleListScroll}
            tabIndex={0}
            aria-label="הודעות בשיחה"
          >
            {messages.length === 0 ? (
              <p className="request-conversation__empty">{MESSAGE_EMPTY_LABEL}</p>
            ) : (
              messages.map((message) => <RequestMessageItem key={message.id} message={message} />)
            )}
          </div>

          <div className="request-conversation__compose">
            <label className="request-conversation__input-label" htmlFor={`request-message-${requestId}`}>
              הודעה חדשה
            </label>
            <textarea
              id={`request-message-${requestId}`}
              className="ds-textarea request-conversation__input"
              rows={3}
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              placeholder={MESSAGE_INPUT_PLACEHOLDER}
              disabled={isSending}
            />
            <div className="request-conversation__actions">
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={() => void handleSendMessage()}
                disabled={isSending || !draftMessage.trim()}
              >
                {isSending ? MESSAGE_LOADING_LABEL : MESSAGE_SEND_BUTTON_LABEL}
              </button>
            </div>
          </div>
        </>
      )}

      {sendError && <p className="ds-form-message ds-form-message--error">{sendError}</p>}
    </section>
  )
}
