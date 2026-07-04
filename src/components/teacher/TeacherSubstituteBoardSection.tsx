import { useCallback, useEffect, useState } from 'react'
import type { CreateSubstituteBoardPostInput, SubstituteBoardPost } from '../../types/substituteBoard'
import {
  createSubstituteBoardPost,
  createSubstituteBoardResponse,
  loadSubstituteBoardPosts,
  loadSubstituteBoardResponsePostIds,
} from '../../services/substituteBoard'
import { validateCreateSubstituteBoardPostInput } from '../../utils/substituteBoard'
import { CreateSubstituteBoardPostForm } from './CreateSubstituteBoardPostForm'
import { SubstituteBoardPostsList } from './SubstituteBoardPostsList'

export function TeacherSubstituteBoardSection() {
  const [posts, setPosts] = useState<SubstituteBoardPost[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [respondedPostIds, setRespondedPostIds] = useState<ReadonlySet<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [createMessage, setCreateMessage] = useState('')
  const [responseMessage, setResponseMessage] = useState('')
  const [responseMessageIsError, setResponseMessageIsError] = useState(false)
  const [respondingPostId, setRespondingPostId] = useState<string | null>(null)
  const [boardVersion, setBoardVersion] = useState(0)
  const [formKey, setFormKey] = useState(0)

  const fetchBoard = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const [postsResult, responsesResult] = await Promise.all([
      loadSubstituteBoardPosts(),
      loadSubstituteBoardResponsePostIds(),
    ])

    if (!postsResult.ok) {
      setPosts([])
      setCurrentUserId('')
      setLoadError(postsResult.errorMessage)
    } else {
      setPosts(postsResult.posts)
      setCurrentUserId(postsResult.currentUserId)
    }

    if (responsesResult.ok) {
      setRespondedPostIds(responsesResult.postIds)
    } else if (postsResult.ok) {
      setRespondedPostIds(new Set())
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    void fetchBoard()
  }, [fetchBoard, boardVersion])

  async function handleCreatePost(input: CreateSubstituteBoardPostInput) {
    setCreateMessage('')

    const validation = validateCreateSubstituteBoardPostInput(input)
    if (!validation.ok) {
      setCreateMessage(validation.errorMessage)
      return
    }

    setIsSubmitting(true)

    const result = await createSubstituteBoardPost(input)

    setIsSubmitting(false)

    if (!result.ok) {
      setCreateMessage(result.errorMessage)
      return
    }

    setCreateMessage('הפרסום נוצר בהצלחה.')
    setFormKey((key) => key + 1)
    setBoardVersion((version) => version + 1)
  }

  async function handleRespond(postId: string) {
    setResponseMessage('')
    setRespondingPostId(postId)

    const result = await createSubstituteBoardResponse(postId)

    setRespondingPostId(null)

    if (!result.ok) {
      setResponseMessage(result.errorMessage)
      setResponseMessageIsError(true)
      return
    }

    setRespondedPostIds((currentIds) => new Set([...currentIds, postId]))
    setResponseMessage('התגובה נשלחה.')
    setResponseMessageIsError(false)
  }

  return (
    <section className="teacher-dashboard__substitute-board">
      <h2 className="teacher-dashboard__section-title">לוח מילויי מקום</h2>

      <div className="ds-card ds-card--accent teacher-dashboard__substitute-create-card">
        <CreateSubstituteBoardPostForm
          key={formKey}
          isSubmitting={isSubmitting}
          submitMessage={createMessage}
          onSubmit={handleCreatePost}
        />
      </div>

      <div className="ds-card teacher-dashboard__substitute-list-card">
        <h3 className="teacher-dashboard__subsection-title">פרסומים בלוח</h3>

        {responseMessage && (
          <p
            className={
              responseMessageIsError
                ? 'ds-form-message ds-form-message--error'
                : 'ds-form-message ds-form-message--success'
            }
          >
            {responseMessage}
          </p>
        )}

        {isLoading && <p className="ds-form-message">טוען לוח מילויי מקום...</p>}

        {!isLoading && loadError && (
          <p className="ds-form-message ds-form-message--error">{loadError}</p>
        )}

        {!isLoading && !loadError && (
          <SubstituteBoardPostsList
            posts={posts}
            currentUserId={currentUserId}
            respondedPostIds={respondedPostIds}
            respondingPostId={respondingPostId}
            onRespond={handleRespond}
            onApprovalSubmitted={() => setBoardVersion((version) => version + 1)}
          />
        )}
      </div>
    </section>
  )
}
