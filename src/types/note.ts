export type RequestNote = {
  id: string
  request_id: string
  note_text: string
  created_at: string
  updated_at: string
  created_by_full_name: string | null
}

export const NOTES_LOADING_MESSAGE = 'טוען הערות...'

export const NOTES_EMPTY_MESSAGE = 'אין הערות לבקשה זו.'

export const NOTES_LOAD_ERROR_MESSAGE = 'טעינת ההערות נכשלה.'

export const NOTE_CREATE_SUCCESS_MESSAGE = 'ההערה נשמרה.'

export const NOTE_UPDATE_SUCCESS_MESSAGE = 'ההערה עודכנה.'

export const NOTE_DELETE_SUCCESS_MESSAGE = 'ההערה נמחקה.'

export const NOTE_SAVE_ERROR_MESSAGE = 'שמירת ההערה נכשלה.'
