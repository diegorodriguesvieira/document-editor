import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { DocumentJSON } from '../../editor'
// Deliberate deep imports: the uid index and attribute stay SDK-internal (off
// the curated src/editor/index.ts barrel), and this module is exactly the
// layer that binds comments to that internal contract.
import { nodeIdIndex } from '../../editor/core/nodeIdIndex'
import { NODE_ID_ATTRIBUTE } from '../../editor/core/nodeIds'

/**
 * One anchored stretch of a comment: WHICH node (by `uid`) and WHERE inside
 * it. A comment's anchor is `nodes: CommentNodeSegment[]` — external to the
 * document, multi-segment because editing fragments anchors (splits, partial
 * deletes, copies).
 *
 * This is the FE↔BE anchor contract (the `nodes[]` column on the comment
 * row), so the offset norm is load-bearing — the backend's quote validator
 * interprets these numbers against the saved JSON:
 *
 * - `from`/`to` are ProseMirror CONTENT offsets local to the node, 0-based,
 *   end-exclusive: `0 <= from < to <= node.content.size`.
 * - Text counts one per character; inline ATOMS (variable/signature chips)
 *   and hardBreak count exactly 1 — they occupy one content position but
 *   contribute no text to the quote.
 *
 * The shared fixture in commentAnchor.golden.ts pins this norm for both
 * sides; the backend's validator must pass those vectors verbatim.
 */
export interface CommentNodeSegment {
  /** The target node's `uid` (the NodeIds identity attribute) — never a
   *  business id like a variable's `attrs.id`. */
  id: string
  from: number
  to: number
}

/**
 * What an anchor WRITE carries: the canonical `nodes[]` plus `quote` — the
 * concatenated text the live segments covered at derivation time, the
 * backend's stale-content checksum (it re-extracts the text from the SAVED
 * document and compares). The pair always travels together: a `nodes[]`
 * without its quote could not be validated.
 */
export interface CommentAnchorPayload {
  nodes: CommentNodeSegment[]
  quote: string
}

/** A payload bound to its comment — what the reporter emits into its sink
 *  and the save envelope carries to the backend. */
export interface CommentAnchorReport extends CommentAnchorPayload {
  id: string
}

/**
 * Where `segment` currently sits in `doc`, as absolute positions — or `null`
 * when it does not anchor: the uid is absent from the document, or the
 * offsets collapse to nothing once clamped.
 *
 * Clamping into `node.content.size` is READ-side repair only — a stale row
 * whose node shrank still highlights what remains instead of throwing.
 * Writes must NEVER clamp: anchors written back to the backend always derive
 * from live mapped positions, and clamping on write would launder a broken
 * offset into a plausible-looking one (the plan's "clamp is read repair"
 * rule).
 */
export function resolveSegment(
  doc: PMNode,
  segment: CommentNodeSegment,
): { from: number; to: number } | null {
  const entry = nodeIdIndex(doc).byId.get(segment.id)
  if (!entry) return null
  const size = entry.node.content.size
  const from = Math.max(0, Math.min(segment.from, size))
  const to = Math.max(0, Math.min(segment.to, size))
  if (from >= to) return null
  // The node's content starts one token past the node's own position.
  const base = entry.pos + 1
  return { from: base + from, to: base + to }
}

/**
 * The canonical derivation of a comment's `nodes[]` from an absolute document
 * range — the geometry every write path shares (capture on create, the
 * reporter in the next phase): one segment per TEXTBLOCK the range touches,
 * clipped to that block's content, in document order.
 *
 * Only textblocks contribute. `nodesBetween` descends THROUGH non-textblock
 * uid carriers (blockquote, list item, table cell…) without emitting them: a
 * comment anchors to the text-bearing leaf blocks, so structural wrappers can
 * split/merge/convert freely without invalidating anchors. It never descends
 * INTO a textblock — offsets are node-local by contract. A textblock without
 * a uid is skipped defensively; entry injection plus the NodeIds extension
 * make that unreachable, but a silent skip beats a corrupt segment.
 */
export function segmentsFromRange(doc: PMNode, from: number, to: number): CommentNodeSegment[] {
  const segments: CommentNodeSegment[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true // descend — wrappers contribute nothing
    const uid = node.attrs[NODE_ID_ATTRIBUTE] as unknown
    if (typeof uid === 'string' && uid !== '') {
      const base = pos + 1 // content starts past the opening token
      const localFrom = Math.max(from, base) - base
      const localTo = Math.min(to, base + node.content.size) - base
      // A range that only grazes the block's boundary tokens covers none of
      // its content — no segment.
      if (localFrom < localTo) segments.push({ id: uid, from: localFrom, to: localTo })
    }
    return false
  })
  return segments
}

/**
 * The concatenated text the segments cover, in ARRAY order — the future
 * `quote` (the backend's stale-content checksum). Unresolvable segments
 * contribute the empty string, so a partially orphaned comment still quotes
 * what it can. No separators are inserted, and atoms/hardBreak inside a
 * segment contribute '' (no `leafText` in this schema) — exactly the offset
 * norm: they count 1 position, quote 0 characters.
 */
export function textForSegments(doc: PMNode, segments: readonly CommentNodeSegment[]): string {
  let text = ''
  for (const segment of segments) {
    const resolved = resolveSegment(doc, segment)
    if (resolved) text += doc.textBetween(resolved.from, resolved.to)
  }
  return text
}

/** The schema name the RETIRED mark-based comments serialized under — kept
 *  only so {@link stripCommentMarks} can recognize legacy documents. */
const LEGACY_COMMENT_MARK = 'comment'

/**
 * MIGRATION VALVE for documents saved before comments went anchor-based: the
 * old model serialized its anchors as `comment` marks, and that mark is GONE
 * from the schema — loading such a doc now THROWS (`enableContentCheck`
 * refuses unknown marks instead of silently wiping content). Run stored JSON
 * through here before `setJSON`/`content` and the legacy anchors are shed:
 * every `{ type: 'comment' }` mark entry is removed (the `marks` array is
 * dropped when it empties), everything else — other marks included — passes
 * through untouched. Pure and immutable: the input document is never mutated.
 */
export function stripCommentMarks(doc: DocumentJSON): DocumentJSON {
  const strip = (node: JSONContent): JSONContent => {
    const next: JSONContent = { ...node }
    if (node.marks) {
      const marks = node.marks.filter((mark) => mark.type !== LEGACY_COMMENT_MARK)
      if (marks.length > 0) next.marks = marks
      else delete next.marks
    }
    if (node.content) next.content = node.content.map(strip)
    return next
  }
  return { doc: strip(doc.doc) }
}
