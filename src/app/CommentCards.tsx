import type { Editor } from '../editor'
import { useDocumentComments } from '../features'

/**
 * A CONSUMER-REWRITTEN comments UI — proof that the right rail is fully ours:
 * different markup and look than the SDK's CommentsPanel, built on the same
 * reactive `useDocumentComments` hook, keeping the click-to-scroll behavior
 * (one chain — the recipe from EXTENDING §6).
 */
export function CommentCards({ editor }: { editor: Editor | null }) {
  const comments = useDocumentComments(editor)

  return (
    <aside className="comment-cards" aria-label="Review notes">
      <div className="comment-cards__title">
        Review notes <span className="comment-cards__badge">{comments.length}</span>
      </div>
      {comments.length === 0 ? (
        <p className="comment-cards__empty">Select text and hit 💬 to add one.</p>
      ) : (
        comments.map((comment, index) => (
          <button
            key={comment.id}
            type="button"
            className="comment-cards__card"
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .setTextSelection({ from: comment.from, to: comment.to })
                .scrollIntoView()
                .run()
            }
          >
            <span className="comment-cards__index">#{index + 1}</span>
            <span className="comment-cards__body">
              <span className="comment-cards__text">{comment.text || '(no text)'}</span>
              <span className="comment-cards__quote">on “{comment.quote}”</span>
            </span>
          </button>
        ))
      )}
    </aside>
  )
}
