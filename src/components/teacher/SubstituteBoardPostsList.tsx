import { Fragment } from 'react'
import type { SubstituteBoardPost } from '../../types/substituteBoard'
import {
  formatSubstituteBoardDate,
  formatSubstituteBoardTime,
  translateSubstituteBoardPostStatus,
  translateSubstituteBoardPostType,
} from '../../utils/substituteBoard'
import { SubstituteBoardPostSelectionPanel } from './SubstituteBoardPostSelectionPanel'

type SubstituteBoardPostsListProps = {
  posts: SubstituteBoardPost[]
  currentUserId: string
  respondedPostIds: ReadonlySet<string>
  respondingPostId: string | null
  onRespond: (postId: string) => void
  onApprovalSubmitted: () => void
}

export function SubstituteBoardPostsList({
  posts,
  currentUserId,
  respondedPostIds,
  respondingPostId,
  onRespond,
  onApprovalSubmitted,
}: SubstituteBoardPostsListProps) {
  if (posts.length === 0) {
    return (
      <div className="teacher-dashboard__empty-state">
        <p className="teacher-dashboard__empty-message">אין פרסומים בלוח כרגע.</p>
      </div>
    )
  }

  return (
    <div className="ds-table-wrapper">
      <table className="ds-table">
        <thead>
          <tr>
            <th>סוג</th>
            <th>מורה</th>
            <th>תאריך</th>
            <th>שעות</th>
            <th>כיתה</th>
            <th>מקצוע</th>
            <th>תיאור</th>
            <th>סטטוס</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => {
            const isOwnPost = post.created_by_user_id === currentUserId
            const hasResponded = respondedPostIds.has(post.id)
            const canRespond = !isOwnPost && !hasResponded

            return (
              <Fragment key={post.id}>
                <tr>
                  <td>{translateSubstituteBoardPostType(post.post_type)}</td>
                  <td>{post.teacher_full_name}</td>
                  <td>{formatSubstituteBoardDate(post.date)}</td>
                  <td>
                    {formatSubstituteBoardTime(post.start_time)} –{' '}
                    {formatSubstituteBoardTime(post.end_time)}
                  </td>
                  <td>{post.class_name ?? '—'}</td>
                  <td>{post.subject ?? '—'}</td>
                  <td>{post.description ?? '—'}</td>
                  <td>{translateSubstituteBoardPostStatus(post.status)}</td>
                  <td>
                    {isOwnPost && (
                      <span className="teacher-dashboard__substitute-own-label">הפרסום שלי</span>
                    )}
                    {hasResponded && !isOwnPost && (
                      <span className="teacher-dashboard__substitute-responded-label">
                        נשלחה תגובה
                      </span>
                    )}
                    {canRespond && (
                      <button
                        type="button"
                        className="ds-btn ds-btn--secondary teacher-dashboard__substitute-respond-button"
                        onClick={() => onRespond(post.id)}
                        disabled={respondingPostId === post.id}
                      >
                        {respondingPostId === post.id ? 'שולחת...' : 'אני יכולה'}
                      </button>
                    )}
                  </td>
                </tr>
                {isOwnPost && post.status === 'open' && (
                  <tr key={`${post.id}-selection`}>
                    <td colSpan={9}>
                      <SubstituteBoardPostSelectionPanel
                        postId={post.id}
                        currentUserId={currentUserId}
                        onSubmitted={onApprovalSubmitted}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
