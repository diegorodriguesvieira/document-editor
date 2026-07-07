import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import Paper from '@mui/material/Paper'
import type { Editor } from '@tiptap/core'
import { useFeatureState } from '../../editor'
import { getCommentThreads } from './comments'

export interface AnchoredComment {
  id: string
  text: string
  quote: string
  from: number
  to: number
}

/**
 * Walk the doc for `comment` marks, merging contiguous runs of the same id into
 * one range, and join with the stored thread text. This is the source of truth
 * for "what is commented" — derived from the document, so it stays correct as
 * text moves (and orphaned threads, whose marks were deleted, drop off the list).
 */
function buildComments(editor: Editor): AnchoredComment[] {
  // Per id, a LIST of segments: a run split by other marks (bold inside a
  // comment) merges back into one segment, but a genuinely discontiguous
  // reuse of the id (copy/paste of commented text) stays a separate entry —
  // min/max there would swallow the uncommented text in between.
  const segments = new Map<string, Array<{ from: number; to: number }>>()
  const doc = editor.state.doc
  doc.descendants((node, pos) => {
    if (!node.isText) return
    // `excludes: ''` allows overlapping comments — a text node can carry
    // SEVERAL comment marks; reading only the first would drop the others.
    for (const mark of node.marks) {
      if (mark.type.name !== 'comment') continue
      const id = mark.attrs.commentId as string
      const list = segments.get(id) ?? []
      const last = list[list.length - 1]
      // Contiguous = no TEXT in the gap (block boundaries produce empty
      // textBetween, so a comment spanning paragraphs stays one entry).
      if (last && (pos <= last.to || doc.textBetween(last.to, pos) === '')) {
        last.to = Math.max(last.to, pos + node.nodeSize)
      } else {
        list.push({ from: pos, to: pos + node.nodeSize })
        segments.set(id, list)
      }
    }
  })

  const threads = getCommentThreads(editor)
  return [...segments.entries()].flatMap(([id, list]) =>
    list.map((range) => ({
      id,
      from: range.from,
      to: range.to,
      quote: doc.textBetween(range.from, range.to, ' '),
      text: threads?.get(id)?.text ?? '',
    })),
  )
}

/** The comments currently anchored in the document, reactive to edits. */
export function useDocumentComments(editor: Editor | null): AnchoredComment[] {
  return useFeatureState(editor, buildComments) ?? []
}

/**
 * Right-side panel listing every comment. Clicking one selects its text and
 * scrolls the editor to it — the way to find a comment without hunting for the
 * yellow highlight.
 */
export function CommentsPanel({ editor }: { editor: Editor | null }) {
  const comments = useDocumentComments(editor)

  // No comments → no panel at all (product rule, shared with any consumer
  // rewrite). It (re)appears reactively with the first anchored comment and
  // leaves again when the last one is deleted.
  if (comments.length === 0) return null

  return (
    <Paper component="aside" className="comments-panel" aria-label="Comments" elevation={0}>
      <div className="comments-panel__title">Comments ({comments.length})</div>
      <List className="comments-panel__list" dense disablePadding>
        {comments.map((comment) => (
          // Discontiguous reuses of one id are separate entries — key by range.
          <ListItem key={`${comment.id}:${comment.from}`} disablePadding>
            <ListItemButton
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
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Paper>
  )
}
