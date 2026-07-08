import { useEffect, useState } from 'react'
import {
  SUBSTITUTE_BOARD_APPROVAL_FAILURE_MESSAGE,
  SUBSTITUTE_BOARD_APPROVAL_SUCCESS_MESSAGE,
  SUBSTITUTE_BOARD_NO_RESPONSES_MESSAGE,
  SUBSTITUTE_BOARD_RESPONSES_LOADING_MESSAGE,
} from '../../types/substituteBoard'
import {
  loadSubstituteBoardPostResponses,
  submitSubstituteBoardPostForApproval,
} from '../../services/substituteBoard'

type SubstituteBoardPostSelectionPanelProps = {
  postId: string
  currentUserId: string
  onSubmitted: () => void
}

export function SubstituteBoardPostSelectionPanel({
  postId,
  currentUserId,
  onSubmitted,
}: SubstituteBoardPostSelectionPanelProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [responses, setResponses] = useState<
    { id: string; teacher_user_id: string; teacher_full_name: string }[]
  >([])
  const [selectedTeacherUserId, setSelectedTeacherUserId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [submitMessageIsError, setSubmitMessageIsError] = useState(false)

  useEffect(() => {
    let isCancelled = false

    async function fetchResponses() {
      setIsLoading(true)
      setLoadError('')
      setSubmitMessage('')

      const result = await loadSubstituteBoardPostResponses(postId)

      if (isCancelled) {
        return
      }

      if (!result.ok) {
        setResponses([])
        setLoadError(result.errorMessage)
      } else {
        const eligibleResponses = result.responses.filter(
          (response) => response.teacher_user_id !== currentUserId,
        )
        setResponses(eligibleResponses)
        setSelectedTeacherUserId('')
      }

      setIsLoading(false)
    }

    void fetchResponses()

    return () => {
      isCancelled = true
    }
  }, [postId, currentUserId])

  async function handleSubmitForApproval() {
    if (responses.length === 0 || !selectedTeacherUserId) {
      return
    }

    if (selectedTeacherUserId === currentUserId) {
      setSubmitMessage(SUBSTITUTE_BOARD_APPROVAL_FAILURE_MESSAGE)
      setSubmitMessageIsError(true)
      return
    }

    setIsSubmitting(true)
    setSubmitMessage('')

    const result = await submitSubstituteBoardPostForApproval({
      postId,
      selectedTeacherUserId,
    })

    setIsSubmitting(false)

    if (!result.ok) {
      setSubmitMessage(result.errorMessage)
      setSubmitMessageIsError(true)
      return
    }

    setSubmitMessage(SUBSTITUTE_BOARD_APPROVAL_SUCCESS_MESSAGE)
    setSubmitMessageIsError(false)
    onSubmitted()
  }

  return (
    <div className="teacher-dashboard__substitute-selection-panel ds-fieldset">
      <p className="teacher-dashboard__substitute-selection-title">בחירת מורה מחליפה</p>

      {isLoading && (
        <p className="teacher-dashboard__substitute-selection-status">
          {SUBSTITUTE_BOARD_RESPONSES_LOADING_MESSAGE}
        </p>
      )}

      {!isLoading && loadError && (
        <p className="teacher-dashboard__substitute-selection-status ds-form-message--error">
          {loadError}
        </p>
      )}

      {!isLoading && !loadError && responses.length === 0 && (
        <p className="teacher-dashboard__substitute-selection-status">
          {SUBSTITUTE_BOARD_NO_RESPONSES_MESSAGE}
        </p>
      )}

      {!isLoading && !loadError && responses.length > 0 && (
        <>
          <ul
            className="teacher-dashboard__substitute-selection-list"
            role="radiogroup"
            aria-label="בחירת מורה מחליפה"
          >
            {responses.map((response) => (
              <li key={response.id}>
                <label className="teacher-dashboard__substitute-selection-option">
                  <input
                    type="radio"
                    name={`substitute-selection-${postId}`}
                    value={response.teacher_user_id}
                    checked={selectedTeacherUserId === response.teacher_user_id}
                    onChange={() => setSelectedTeacherUserId(response.teacher_user_id)}
                    disabled={isSubmitting}
                  />
                  <span>{response.teacher_full_name}</span>
                </label>
              </li>
            ))}
          </ul>

          <div className="ds-form-actions">
            <button
              type="button"
              className="ds-btn ds-btn--primary teacher-dashboard__substitute-approval-button"
              onClick={() => void handleSubmitForApproval()}
              disabled={isSubmitting || !selectedTeacherUserId}
            >
              {isSubmitting ? 'שולחת...' : 'שליחה לאישור מזכירה'}
            </button>
          </div>
        </>
      )}

      {submitMessage && (
        <p
          className={
            submitMessageIsError
              ? 'teacher-dashboard__substitute-selection-status ds-form-message--error'
              : 'teacher-dashboard__substitute-selection-status ds-form-message--success'
          }
        >
          {submitMessage}
        </p>
      )}
    </div>
  )
}
