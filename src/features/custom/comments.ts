import { defineFeature, Extension, Mark, mergeAttributes } from '../../editor'
import type { Editor } from '../../editor'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  COMMENT_MARK,
  collectCommentAnchors,
  stripCommentMarksFromSlice,
} from './commentAnchors'
import type { CommentDraft } from './commentsProvider'

/**
 * What the kernel plugin reads beyond the document itself. {@link CommentsLayer}
 * keeps it in sync with the {@link CommentsProvider} (and nudges a re-render).
 * The comments themselves are NOT here anymore — their anchors live in the doc
 * as `comment` marks; only the transient review state passes through storage.
 */
export interface CommentsStorage {
  draft: CommentDraft | null
  activeId: string | null
  /** Set by {@link CommentsLayer}: a document click landed ON a comment
   *  highlight (its id) or OFF every highlight (null) — drives the panel's
   *  active card, the mirror of the panel's click-to-highlight. */
  onCommentClick: ((id: string | null) => void) | null
}

/**
 * The one typed accessor for the comments storage — the single place the
 * `editor.storage` cast lives, beside the extension that owns that storage.
 */
export function getCommentsStorage(editor: Editor): CommentsStorage | undefined {
  const storage = editor.storage as unknown as { comments?: CommentsStorage }
  return storage.comments
}

/**
 * The anchor half of a comment: a mark carrying only the backend's id. The
 * comment CONTENT (text/author/…) stays backend-side (see `CommentsAdapter`);
 * the mark is what lets ProseMirror move the anchor through edits for free.
 * `inclusive: false` so typing at the edges doesn't grow the comment;
 * `excludes: ''` so overlapping comments coexist (they render as nested
 * spans, each with its own `data-comment-id`).
 */
const CommentMark = Mark.create({
  name: COMMENT_MARK,
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) =>
          attributes.commentId ? { 'data-comment-id': attributes.commentId as string } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment' }), 0]
  },
})

/**
 * The interaction plugin around the mark, live in BOTH modes (highlights are
 * part of the document now — review mode is only where NEW comments happen):
 *
 * - draft/active emphasis as decorations over the marked ranges;
 * - click → innermost comment id, reported to the panel;
 * - pasted/dropped slices stripped of comment marks. (ProseMirror also runs
 *   `transformPasted` on internal drag-MOVES, so dragging commented text
 *   orphans the comment — accepted, consistent with delete-and-retype.)
 */
const CommentsKernel = Extension.create({
  // Storage is keyed by extension name — `getCommentsStorage` depends on it.
  name: 'comments',

  addStorage(): CommentsStorage {
    return { draft: null, activeId: null, onCommentClick: null }
  },

  addProseMirrorPlugins() {
    const storage = this.storage as CommentsStorage
    return [
      new Plugin({
        key: new PluginKey('commentsKernel'),
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = []
            if (storage.activeId) {
              const anchor = collectCommentAnchors(state.doc).get(storage.activeId)
              // Per SEGMENT, never the union — a fragmented mark's gap must
              // not light up. Only the modifier class: the decoration span
              // nests inside the mark's `.comment` span, and doubling that
              // class would double its border.
              for (const segment of anchor?.segments ?? []) {
                decorations.push(
                  Decoration.inline(segment.from, segment.to, { class: 'comment--active' }),
                )
              }
            }
            if (storage.draft) {
              const max = state.doc.content.size
              const clamp = (pos: number) => Math.max(0, Math.min(pos, max))
              const from = clamp(storage.draft.from)
              const to = clamp(storage.draft.to)
              if (from < to) {
                decorations.push(Decoration.inline(from, to, { class: 'comment comment--draft' }))
              }
            }
            return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null
          },
          // Clicking a highlight activates its comment in the panel (the
          // mirror of the panel's click-to-scroll); clicking plain text
          // deactivates. Never consumes the click — the caret still lands.
          handleClick: (view, pos) => {
            const notify = storage.onCommentClick
            if (!notify) return false
            // Overlaps: the INNERMOST (smallest total span) comment wins.
            let hitId: string | null = null
            let hitSpan = Infinity
            for (const [id, anchor] of collectCommentAnchors(view.state.doc)) {
              if (!anchor.segments.some((seg) => pos >= seg.from && pos <= seg.to)) continue
              const span = anchor.to - anchor.from
              if (span < hitSpan) {
                hitId = id
                hitSpan = span
              }
            }
            notify(hitId)
            return false
          },
          transformPasted: (slice, view) => stripCommentMarksFromSlice(slice, view.state.schema),
        },
      }),
    ]
  },
})

/**
 * Comments with in-document anchors: the `comment` mark (serializes to
 * JSON/HTML as `data-comment-id`) plus the interaction kernel. The UI lives in
 * {@link CommentsLayer} (the review-only "Add comment" balloon — mount it in
 * BOTH modes; it is also the provider↔doc reconciliation bridge) and
 * {@link CommentsPanel} (composer + cards), both fed by {@link CommentsProvider}.
 *
 * Contributes — extensions only (no bubble/insert items). Highlights render in
 * edit mode too; only COMPOSING a comment is review-mode-only.
 */
export const CommentsFeature = defineFeature({
  id: 'comments',
  extensions: () => [CommentMark, CommentsKernel],
})
