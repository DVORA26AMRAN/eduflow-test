export type SubstituteBoardPostType =
  | 'looking_for_substitute'
  | 'available_for_substitute'

export type SubstituteBoardPostStatus =
  | 'open'
  | 'pending_secretary_approval'
  | 'approved'
  | 'cancelled'

export type SubstituteBoardPost = {
  id: string
  post_type: SubstituteBoardPostType
  status: SubstituteBoardPostStatus
  date: string
  start_time: string | null
  end_time: string | null
  class_name: string | null
  subject: string | null
  description: string | null
  created_by_user_id: string
  teacher_full_name: string
  created_at: string
}

export type CreateSubstituteBoardPostInput = {
  postType: SubstituteBoardPostType
  date: string
  startTime: string
  endTime: string
  className: string
  subject: string
  description: string
}

export type SubstituteBoardResponse = {
  id: string
  post_id: string
  teacher_user_id: string
  teacher_full_name: string
  response_text: string | null
  created_at: string
}

export const SUBSTITUTE_BOARD_RESPONSES_LOADING_MESSAGE = 'טוען מתנדבות...'

export const SUBSTITUTE_BOARD_NO_RESPONSES_MESSAGE = 'עדיין אין מורות זמינות.'

export const SUBSTITUTE_BOARD_APPROVAL_SUCCESS_MESSAGE = 'נשלח לאישור מזכירה.'

export const SUBSTITUTE_BOARD_APPROVAL_FAILURE_MESSAGE = 'שליחה לאישור נכשלה.'
