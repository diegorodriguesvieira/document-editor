import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { CommentThread } from './comments'

export interface AnchoredComment {
  id: string
  text: string
  quote: string
  from: number
  to: number
}

/**
 * The one typed accessor for the comment mark's storage — the single place the
 * `editor.storage` cast lives. (Declared here rather than in comments.ts: the
 * feature file already runtime-imports this module for the panel contribution,
 * so the reverse runtime import would create an eval-order-sensitive cycle.)
 */
export function getCommentThreads(editor: Editor): Map<string, CommentThread> | undefined {
  const storage = editor.storage as unknown as { comment?: { threads: Map<string, CommentThread> } }
  return storage.comment?.threads
}

/**
 * Walk the doc for `comment` marks, merging contiguous runs of the same id into
 * one range, and join with the stored thread text. This is the source of truth
 * for "what is commented" — derived from the document, so it stays correct as
 * text moves (and orphaned threads, whose marks were deleted, drop off the list).
 */
function buildComments(editor: Editor): AnchoredComment[] {
  const ranges = new Map<string, { from: number; to: number }>()
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find((m) => m.type.name === 'comment')
    if (!mark) return
    const id = mark.attrs.commentId as string
    const range = ranges.get(id)
    if (range) {
      range.from = Math.min(range.from, pos)
      range.to = Math.max(range.to, pos + node.nodeSize)
    } else {
      ranges.set(id, { from: pos, to: pos + node.nodeSize })
    }
  })

  const threads = getCommentThreads(editor)
  return [...ranges.entries()].map(([id, range]) => ({
    id,
    from: range.from,
    to: range.to,
    quote: editor.state.doc.textBetween(range.from, range.to, ' '),
    text: threads?.get(id)?.text ?? '',
  }))
}

/** The comments currently anchored in the document, reactive to edits. */
export function useDocumentComments(editor: Editor | null): AnchoredComment[] {
  const comments = useEditorState({
    editor,
    selector: ({ editor }) => (editor ? buildComments(editor) : []),
  })
  return comments ?? []
}

/**
 * Right-side panel listing every comment. Clicking one selects its text and
 * scrolls the editor to it — the way to find a comment without hunting for the
 * yellow highlight.
 */
export function CommentsPanel({ editor }: { editor: Editor | null }) {
  const comments = useDocumentComments(editor)

  return (
    <aside className="comments-panel" aria-label="Comments">
      <div className="comments-panel__title">Comments ({comments.length})</div>
      {comments.length === 0 ? (
        <p className="comments-panel__empty">Select text and click 💬 to comment.</p>
      ) : (
        <ul className="comments-panel__list">
          {comments.map((comment) => (
            <li key={comment.id}>
              <button
                type="button"
                className="comments-panel__item"
                onClick={() =>
                  editor
                    ?.chain()
                    .focus()
                    .setTextSelection({ from: comment.from, to: comment.to })
                    .scrollIntoView()
                    .run()
                }
              >
                <span className="comments-panel__quote">“{comment.quote}”</span>
                {comment.text ? <span className="comments-panel__text">{comment.text}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
