import { Fragment, Slice } from '@tiptap/pm/model'
import type { MarkType, Node as PMNode, Schema } from '@tiptap/pm/model'
import type { Editor } from '../../editor'

/** The comment mark's schema name — the single spelling shared by the mark
 *  definition and every doc walk in this module. */
export const COMMENT_MARK = 'comment'

/**
 * Where one comment's mark lives in the document. `segments` are the actual
 * marked stretches (editing can fragment a mark — e.g. deleting text from its
 * middle); `from`/`to` are the min/max union, used only to compare spans
 * (innermost-wins hit-testing) — never to highlight, or a fragmented mark's
 * gap would light up.
 */
export interface CommentAnchor {
  from: number
  to: number
  segments: Array<{ from: number; to: number }>
}

/* One walk per doc VERSION: PM docs are immutable, so the doc node is a
   perfect cache key — selection-only transactions reuse the entry, and the
   layer/panel selectors, the kernel's decoration pass and handleClick all
   share the single walk. */
const anchorsCache = new WeakMap<PMNode, Map<string, CommentAnchor>>()

/**
 * One doc walk → every anchored comment id and its range(s). Walks every
 * INLINE node, not just text — `tr.addMark` also marks inline atoms (variable
 * chips) inside the range, and skipping them would leave un-strippable ghost
 * anchors. Marks with a missing/empty (or control-character) `commentId` are
 * ignored here (they are strip fodder for {@link stripDanglingCommentAnchors}).
 */
export function collectCommentAnchors(doc: PMNode): Map<string, CommentAnchor> {
  const cached = anchorsCache.get(doc)
  if (cached) return cached
  const anchors = new Map<string, CommentAnchor>()
  doc.descendants((node, pos) => {
    if (!node.isInline) return
    for (const mark of node.marks) {
      if (mark.type.name !== COMMENT_MARK) continue
      const id = mark.attrs.commentId
      if (typeof id !== 'string' || id.length === 0 || id.includes('\u0000')) continue
      const from = pos
      const to = pos + node.nodeSize
      const anchor = anchors.get(id)
      if (!anchor) {
        anchors.set(id, { from, to, segments: [{ from, to }] })
        continue
      }
      const last = anchor.segments[anchor.segments.length - 1]
      if (last.to === from) last.to = to
      else anchor.segments.push({ from, to })
      anchor.from = Math.min(anchor.from, from)
      anchor.to = Math.max(anchor.to, to)
    }
  })
  anchorsCache.set(doc, anchors)
  return anchors
}

/**
 * Marks the range as belonging to comment `id` — the moment a backend-created
 * comment gets its anchor. Off-history: undo must never remove an anchor.
 * Returns false (no dispatch) when the range collapses under clamping — the
 * comment then simply lives on as an orphan in the panel.
 */
export function applyCommentAnchor(
  editor: Editor,
  id: string,
  range: { from: number; to: number },
): boolean {
  const { state } = editor
  const markType = state.schema.marks[COMMENT_MARK]
  if (!markType) return false
  const max = state.doc.content.size
  const from = Math.max(0, Math.min(range.from, max))
  const to = Math.max(0, Math.min(range.to, max))
  if (from >= to) return false
  editor.view.dispatch(
    state.tr.addMark(from, to, markType.create({ commentId: id })).setMeta('addToHistory', false),
  )
  return true
}

/**
 * Removes every comment mark whose id is not in `keepIds` (including marks
 * with no id at all) — the doc-side half of reconciling against the backend
 * list. `removeMark` with a concrete mark instance only removes `eq` marks,
 * so overlapping siblings survive. No-ops without a dispatch when clean.
 */
export function stripDanglingCommentAnchors(editor: Editor, keepIds: ReadonlySet<string>): void {
  const { state } = editor
  const markType = state.schema.marks[COMMENT_MARK]
  if (!markType) return
  const tr = state.tr
  state.doc.descendants((node, pos) => {
    // Every INLINE node: `tr.addMark` also marks inline atoms (variable
    // chips), and a text-only walk would leave them as ghost anchors.
    if (!node.isInline) return
    for (const mark of node.marks) {
      if (mark.type !== markType) continue
      const id = mark.attrs.commentId
      if (typeof id === 'string' && id.length > 0 && keepIds.has(id)) continue
      // Mark removal never shifts positions, so original offsets stay valid
      // while steps accumulate on the one transaction.
      tr.removeMark(pos, pos + node.nodeSize, mark)
    }
  })
  if (tr.steps.length === 0) return
  editor.view.dispatch(tr.setMeta('addToHistory', false))
}

function stripFragment(fragment: Fragment, markType: MarkType): Fragment {
  const children: PMNode[] = []
  fragment.forEach((node) => {
    let next = node.mark(node.marks.filter((mark) => mark.type !== markType))
    if (next.content.childCount > 0) next = next.copy(stripFragment(next.content, markType))
    children.push(next)
  })
  return Fragment.fromArray(children)
}

/**
 * Pasted/dropped content arrives without comment marks — otherwise copy/paste
 * would duplicate a `commentId` across the doc (and external HTML carrying
 * `data-comment-id` spans would resurrect deleted comments via the parse
 * rule).
 */
export function stripCommentMarksFromSlice(slice: Slice, schema: Schema): Slice {
  const markType = schema.marks[COMMENT_MARK]
  if (!markType) return slice
  return new Slice(stripFragment(slice.content, markType), slice.openStart, slice.openEnd)
}
