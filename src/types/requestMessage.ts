export const NOTIFICATION_TYPE_REQUEST_MESSAGE = 'REQUEST_MESSAGE_RECEIVED'

export const MESSAGE_LOADING_LABEL = 'טוען שיחה...'

export const MESSAGE_LOAD_ERROR = 'טעינת השיחה נכשלה.'

export const MESSAGE_EMPTY_LABEL = 'אין הודעות בשיחה עדיין.'

export const MESSAGE_SEND_ERROR = 'שליחת ההודעה נכשלה.'

export const MESSAGE_INPUT_PLACEHOLDER = 'כתיבת הודעה...'

export const MESSAGE_SEND_BUTTON_LABEL = 'שלח'

export const CONVERSATION_SECTION_TITLE = 'שיחה'

export const CONVERSATION_UNREAD_BADGE_LABEL = 'הודעה חדשה'

export type RequestMessage = {
  id: string
  request_id: string
  author_user_id: string
  message: string
  created_at: string
  author_full_name: string | null
  author_primary_role: string | null
}

export type OptimisticRequestMessage = RequestMessage & {
  isOptimistic?: boolean
}
