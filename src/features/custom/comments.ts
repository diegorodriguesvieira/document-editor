import { defineFeature, Extension } from '../../editor'
import type { Editor } from '../../editor'
import { combineTransactionSteps, findChildrenInRange, getChangedRanges } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode, Slice } from '@tiptap/pm/model'
// Deliberate deep imports (all off the curated src/editor/index.ts barrel):
// the uid index segments anchor to, the uid attribute name, the meta
// EditorApi.setJSON stamps on full document replaces, and the remap meta the
// uid kernel stamps when a colliding paste re-mints a copy (the copy-extend
// feed).
import { nodeIdIndex } from '../../editor/core/nodeIdIndex'
import { NODE_ID_ATTRIBUTE } from '../../editor/core/nodeIds'
import { DOCUMENT_REPLACED_META } from '../../editor/core/EditorApi'
import { UID_REMAPPED_META, type UidRemapMeta } from '../../editor/core/nodeIdsExtension'
import {
  resolveSegment,
  segmentsFromRange,
  textForSegments,
  type CommentAnchorPayload,
  type CommentAnchorReport,
  type CommentNodeSegment,
} from './commentAnchor'
import type { CommentDraft } from './commentsProvider'

/** One externally-stored comment anchor: the backend row's id plus its
 *  `nodes[]` — the multi-segment anchor (see {@link CommentNodeSegment}). */
export interface CommentAnchorRecord {
  id: string
  nodes: CommentNodeSegment[]
  /** The row's stored quote, when the bridge knows it — it seeds the
   *  reporter's last-reported baseline so a clean seed (doc matching what the
   *  backend saved) starts silent. Optional: absent, the baseline quote is
   *  read from the doc at the stored offsets instead. */
  quote?: string
}

/**
 * What the kernel plugins read beyond the document itself. {@link CommentsLayer}
 * keeps it in sync with the {@link CommentsProvider} (and nudges a re-render).
 * `comments` is the whole anchor population: external `nodes[]` anchors the
 * segments plugin resolves and maps — nothing about a comment ever lives in
 * the document.
 */
export interface CommentsStorage {
  draft: CommentDraft | null
  activeId: string | null
  /** Set by {@link CommentsLayer}: a document click landed ON a comment
   *  highlight (its id) or OFF every highlight (null) — drives the panel's
   *  active card, the mirror of the panel's click-to-highlight. */
  onCommentClick: ((id: string | null) => void) | null
  /** The anchor-model comments. The bridge lands the provider list here and
   *  nudges (the storage+nudge idiom — storage mutates outside the
   *  transaction stream, the no-op dispatch is what makes the plugin see it). */
  comments: CommentAnchorRecord[]
  /** Set by the segments plugin's view: the CURRENT canonical payload of
   *  every comment whose anchors drifted from the last confirmed save. A
   *  report whose `nodes` is empty is the DETACH write — the comment's text
   *  was proven deleted and the stored row must stop describing it.
   *  Read-only — nothing clears until {@link CommentsStorage.confirmAnchorsSaved}.
   *  Reads the live editor state, so calling it in the same synchronous frame
   *  as `getJSON()` yields the envelope's coherent doc+anchors pair (the
   *  rodada-6 coherence law). */
  collectDirtyAnchors: (() => CommentAnchorReport[]) | null
  /** Set by the segments plugin's view: the envelope carrying these payloads
   *  was confirmed saved — they become the persisted-truth baselines. Dirt
   *  that arrived AFTER the collect stays dirty for the next envelope. */
  confirmAnchorsSaved: ((reports: CommentAnchorReport[]) => void) | null
  /** Set by the segments plugin's view: ids whose anchors currently differ
   *  from the confirmed baselines — the panel's `pendingSave` badges. */
  dirtyAnchorIds: (() => string[]) | null
  /** Set by the segments plugin's view: the CURRENT canonical payload of ONE
   *  tracked anchor, or null when nothing of it is live. Queued creates ride
   *  this (registered under their `tempId`) so an envelope never carries a
   *  submit-time payload the document has moved past. */
  anchorPayloadFor: ((id: string) => CommentAnchorPayload | null) | null
  /** Notified whenever the dirty picture may have changed (sweep, reset,
   *  confirm) — the provider re-derives badge states here. */
  onAnchorLedgerChanged: (() => void) | null
}

/**
 * The one typed accessor for the comments storage — the single place the
 * `editor.storage` cast lives, beside the extension that owns that storage.
 */
export function getCommentsStorage(editor: Editor): CommentsStorage | undefined {
  const storage = editor.storage as unknown as { comments?: CommentsStorage }
  return storage.comments
}

/* ------------------------------------------------------------------------- *
 * The multi-segment anchor plugin (external `nodes[]` anchors)
 * ------------------------------------------------------------------------- */

/** One stored segment plus where it lives in the CURRENT doc — or null while
 *  DORMANT. On an in-session collapse `stored` is REFRESHED from the
 *  pre-collapse live geometry and `dormantText` snapshots the exact text it
 *  covered; revival re-resolves `stored` and accepts only a text match (the
 *  anti-ghost truth gate). Entries seeded dormant from storage carry no
 *  snapshot and revive only on uid reappearance. Write paths never recompute
 *  or clamp stored offsets. */
interface SegmentEntry {
  stored: CommentNodeSegment
  live: { from: number; to: number } | null
  /** Set while dormant from an IN-SESSION collapse: the text `stored` covered
   *  at collapse time. Absent on seeded dormants. */
  dormantText?: string
  /** Marks BOTH ends of a cut+paste MOVE: the range the cut took (kept as the
   *  undo seed) and the one the paste created. Whichever end is dormant is
   *  not a detached piece of the comment — the text is not missing, it moved
   *  — so the card never reads "partially detached" for a move, in either
   *  direction (paste, or the undo that reverts it). */
  moved?: boolean
}

interface LiveEntry extends SegmentEntry {
  live: { from: number; to: number }
}

interface CommentSegmentsState {
  /** Per comment id, in storage order. Each array's live ranges are kept
   *  normalized (sorted, coalesced) after every change. */
  comments: Map<string, SegmentEntry[]>
  /** Tombstones — ids whose every live range collapsed through MAPPING (the
   *  commented text was edited away), each keeping its COLLAPSE-TIME entry
   *  snapshot (refreshed stored + covered text). Only the revival triggers
   *  (or the id leaving storage) touch them again, and resurrection resolves
   *  the SNAPSHOT — never the storage record — through the same text gate.
   *  The membership reconcile must keep skipping them, or the next nudge
   *  would re-seed stored offsets over whatever text sits there now. */
  dropped: Map<string, SegmentEntry[]>
  decorations: DecorationSet
  /** The activeId decorations were last built with — the change detector. */
  activeId: string | null
}

const commentSegmentsKey = new PluginKey<CommentSegmentsState>('commentSegments')

/**
 * Sort + coalesce over the LIVE ranges (touching or overlapping ranges fuse
 * — same-block geometry only, block boundaries keep two tokens between
 * ranges), carrying each entry's `stored` along. When live ranges of
 * adjacent segments coalesce, their entries MERGE and the merged entry keeps
 * the FIRST segment's `stored`: stored is only a revival seed at this point,
 * and the reporter (next phase) rewrites every anchored comment's stored from
 * its live geometry anyway — inventing a fused stored here would be write-side
 * derivation in the wrong layer. Dormant entries ride behind the lives; their
 * relative order is not load-bearing (document order of the LIVE ranges is
 * what decorations and jump read).
 *
 * Normalizing is what closes the seam: two ranges left touching (a block
 * merge, adjacent stored segments) MUST fuse before the next mapping, because
 * typing exactly at their junction pushes both biased endpoints away from the
 * caret and would leave a permanent hole in the highlight.
 */
function normalizeEntries(entries: SegmentEntry[]): SegmentEntry[] {
  const lives = entries.filter((entry): entry is LiveEntry => entry.live !== null)
  if (lives.length === 0) return entries
  lives.sort((a, b) => a.live.from - b.live.from || a.live.to - b.live.to)
  const merged: LiveEntry[] = []
  for (const entry of lives) {
    const last = merged[merged.length - 1]
    if (last && entry.live.from <= last.live.to) {
      if (entry.live.to > last.live.to) last.live = { from: last.live.from, to: entry.live.to }
      // absorbed — the FIRST segment's stored stays
    } else {
      merged.push({ ...entry, live: { ...entry.live } })
    }
  }
  return [...merged, ...entries.filter((entry) => entry.live === null)]
}

/** Resolve a storage record into fresh state entries — every seed path
 *  (membership, revival, full re-seed) goes through here so seed-time
 *  adjacency coalesces immediately. */
function seedEntries(doc: PMNode, record: CommentAnchorRecord): SegmentEntry[] {
  return normalizeEntries(
    record.nodes.map((stored) => ({ stored, live: resolveSegment(doc, stored) })),
  )
}

/* ------------------------------------------------------------------------- *
 * Copy-extend — pastes that duplicate a commented node (plan §6, decision 5)
 * ------------------------------------------------------------------------- */

/** One character per content position of a textblock: text counts 1:1 and
 *  every non-text LEAF (variable chip, hardBreak) contributes exactly this
 *  placeholder — the explicit `leafText` argument replaces a leaf's text
 *  wholesale, before the spec's own `leafText` is even consulted
 *  (prosemirror-model@1.25.9, Fragment.textBetween: `!node.isLeaf ? "" :
 *  leafText ? (typeof leafText === "function" ? leafText(node) : leafText) :
 *  node.type.spec.leafText ? …`). Plain `textContent` would flatten atoms to
 *  '' and shear the alignment one short per chip, because the offset norm
 *  counts them as 1. Textblock content in this schema is exclusively text and
 *  leaves, so the string's length equals `content.size` and string indices
 *  ARE content offsets. */
const LEAF_PLACEHOLDER = ' '

function contentString(node: PMNode): string {
  return node.textBetween(0, node.content.size, undefined, LEAF_PLACEHOLDER)
}

/**
 * COPY-EXTEND (plan §6, decision 5): a paste that DUPLICATES a node hosting
 * comment segments collides on the uid, the NodeIds kernel re-mints the copy
 * and records `new uid → source uid` in {@link UID_REMAPPED_META} — and the
 * same comment must then point at the copy too. For each remap pair, align the
 * copy's content inside the source's ({@link contentString} on both, so chips
 * and hardBreaks hold their one-position width) and intersect the copied
 * window with every segment living on the source; each non-empty intersection
 * becomes a NEW segment on the copy, offsets shifted into the copy's frame.
 * Returns the ids of the comments extended; scope is inherently same-editor
 * (the meta never leaves the dispatch that minted it).
 *
 * The alignment doubles as the split-vs-copy discriminator: the kernel's
 * collision rule cannot tell a mid-block split from a paste (both birth a
 * newborn carrying a taken uid), so splits record a remap too — but a split's
 * halves PARTITION the text, the first half no longer contains the second's,
 * `indexOf` misses, and the pair is skipped. Exactly right: the split's two
 * ranges are already tracked by live mapping, and extending would double-count
 * the covered text. First match is a documented trade-off: when the copied
 * text occurs more than once in the source (or a repetitive block splits so
 * the tail's text also occurs in the head), the earliest occurrence wins and
 * the intersection may bind to — or miss — the wrong occurrence. Accepted:
 * the occurrences carry identical characters, and the quote validator only
 * ever checks text.
 *
 * Segments are read from LIVE geometry (`segmentsFromRange` over each live
 * range), never from `stored`: stored may lag behind unreported edits, while
 * the alignment was computed against the CURRENT content. Dormant entries
 * never extend — no live range means no proof the source still carries the
 * commented text.
 *
 * This is the REMAP half of copy-extend: it covers every paste that
 * materializes a node (full-block copies, multi-block middles). The dominant
 * gesture — text selected, copied and pasted at a caret — MERGES an open
 * slice into an existing block instead, births no node and therefore no
 * remap; {@link extendEntriesForMergedPaste} owns that half.
 */
/**
 * The intersection engine BOTH copy-extend halves share: every LIVE segment
 * overlapping the copied window [align, windowTo) on `sourceUid` becomes an
 * addition on `targetUid`, offsets rebased to `targetBase + (offset − align)`
 * (base 0 for a materialized copy — the copy's own frame; the insertion's
 * local offset for a merge). Dormant segments never extend. Mutates
 * `comments` in place; returns the ids extended.
 */
function extendComments(
  doc: PMNode,
  comments: Map<string, SegmentEntry[]>,
  sourceUid: string,
  targetUid: string,
  align: number,
  windowTo: number,
  targetBase: number,
): Set<string> {
  const extended = new Set<string>()
  for (const [id, entries] of comments) {
    const additions: SegmentEntry[] = []
    for (const entry of entries) {
      if (!entry.live) continue // never extend from a dormant segment
      for (const part of segmentsFromRange(doc, entry.live.from, entry.live.to)) {
        if (part.id !== sourceUid) continue
        const from = Math.max(part.from, align)
        const to = Math.min(part.to, windowTo)
        if (from >= to) continue // the copy took none of the commented text
        const stored: CommentNodeSegment = {
          id: targetUid,
          from: targetBase + (from - align),
          to: targetBase + (to - align),
        }
        additions.push({ stored, live: resolveSegment(doc, stored) })
      }
    }
    if (additions.length > 0) {
      comments.set(id, [...entries, ...additions])
      extended.add(id)
    }
  }
  return extended
}

function extendEntriesForRemaps(
  doc: PMNode,
  remaps: UidRemapMeta,
  comments: Map<string, SegmentEntry[]>,
): Set<string> {
  const extended = new Set<string>()
  const index = nodeIdIndex(doc)
  for (const [newUid, sourceUid] of remaps) {
    // Both ends must exist in the landed doc — a remap whose source vanished
    // (or whose copy a later fix rewrote) extends nothing.
    const source = index.byId.get(sourceUid)
    const copy = index.byId.get(newUid)
    if (!source || !copy) continue
    const copyText = contentString(copy.node)
    if (copyText.length === 0) continue
    const align = contentString(source.node).indexOf(copyText)
    if (align === -1) continue // split shape (or unrelated content) — skip
    for (const id of extendComments(
      doc,
      comments,
      sourceUid,
      newUid,
      align,
      align + copyText.length,
      0,
    )) {
      extended.add(id)
    }
  }
  return extended
}

/** The uid of a slice edge's textblock, descending single-child wrappers (a
 *  copy out of a list arrives wrapped in its context). */
function edgeUid(node: PMNode | null | undefined): string | null {
  let candidate = node
  while (candidate && !candidate.isTextblock && candidate.childCount === 1) {
    candidate = candidate.firstChild
  }
  if (!candidate?.isTextblock) return null
  const uid = candidate.attrs[NODE_ID_ATTRIBUTE] as unknown
  return typeof uid === 'string' && uid !== '' ? uid : null
}

/** The source uids of a pasted slice's OPEN edges — the halves that will
 *  MERGE into existing blocks instead of materializing as nodes of their own
 *  (a materialized node collides on its uid and goes through the remap half).
 *  Read on the PRE-FIT clipboard slice inside `transformPasted`, because the
 *  fitter strips those wrappers before the step is built. A single-child open
 *  slice has ONE edge: `start` covers it, `end` stays null so nothing extends
 *  twice. */
interface PastedEdgeUids {
  start: string | null
  end: string | null
}

function pastedEdgeUids(slice: Slice): PastedEdgeUids {
  const { content, openStart, openEnd } = slice
  if (content.childCount === 0) return { start: null, end: null }
  return {
    start: openStart > 0 ? edgeUid(content.firstChild) : null,
    end: openEnd > 0 && content.childCount > 1 ? edgeUid(content.lastChild) : null,
  }
}

/**
 * COPY-EXTEND, merge half (plan §6, the partial-copy rule): a text selection
 * copied and pasted at a caret travels as an OPEN slice that MERGES into the
 * target textblock — no node is born, no uid collides, the remap half never
 * fires. Identity comes from the {@link pastedEdgeUids} latch; geometry
 * comes from the paste transaction's own replace step (inline-only slice =
 * the merged shape). The landed text is located in the source by content
 * alignment — the remap half's discriminators apply unchanged — and every
 * live-segment intersection lands on the TARGET node, the block the caret
 * merged into, in target-local offsets.
 *
 * Scope drawn on purpose:
 * - A landed block holding the SOURCE uid is skipped: either the slice
 *   materialized after all (the remap half's case, pre-re-mint) or the text
 *   was pasted back into its own source, where first-occurrence alignment
 *   cannot tell copy from original.
 * - Only LIVE segments extend, same as the remap half — so a drop that MOVED
 *   text extends nothing here (the delete collapsed the segment first), while
 *   an alt-drag COPY extends. The MOVE is the cut-carry's job instead: a drop
 *   that deleted its own dragged selection records a carry buffer inline, so
 *   the comment follows a drag exactly as it follows cut+paste. Deleted text
 *   that never comes back stays dead: anti-ghost holds.
 * - The open EDGE blocks of a multi-block copy stay uncovered (they never
 *   latch) — accepted; their closed middles still extend via the remap half.
 */
/** Where merged content LANDED: the target textblock's uid, the text that
 *  merged into it and the offset it starts at. */
interface PasteLanding {
  targetUid: string
  text: string
  offset: number
}

/** A landing whose block exists but has NO uid yet — the NodeIds kernel
 *  stamps blocks born in this dispatch through an APPENDED transaction, so a
 *  paste that merged into a brand-new block (the tail edge of a multi-block
 *  paste, which splits the target) has nothing to anchor to until that
 *  transaction lands. Retried once, on the very next apply: the kernel's
 *  transaction is attribute-only, so `pos` still means what it meant. */
interface PasteSpot {
  pos: number
  text: string
  atEnd: boolean
}

interface PendingLanding extends PasteSpot {
  sourceUid: string
  /** Applies spent waiting for the kernel to stamp the landing block. The
   *  appendTransaction FIXPOINT can run several rounds (a trailing paragraph,
   *  then the uid pass), so one retry is not enough — but the window must
   *  stay short, or a later edit would be mistaken for the paste settling. */
  tries: number
}

function landingAt(doc: PMNode, spot: PasteSpot): PasteLanding | null {
  if (spot.text.length === 0 || spot.pos < 0 || spot.pos > doc.content.size) return null
  const $pos = doc.resolve(spot.pos)
  if (!$pos.parent.isTextblock) return null
  const targetUid = $pos.parent.attrs[NODE_ID_ATTRIBUTE] as unknown
  if (typeof targetUid !== 'string' || targetUid === '') return null
  // An END edge's text ENDS at `pos`; a START edge's begins there.
  const offset = spot.atEnd ? $pos.parentOffset - spot.text.length : $pos.parentOffset
  return offset < 0 ? null : { targetUid, text: spot.text, offset }
}

/**
 * Where a paste's MERGED halves landed — one per open edge of the slice.
 * Two shapes reach here: the fitter reduced a single-block copy to bare
 * inline content (the whole step slice is the merged text), or a multi-block
 * copy kept its blocks and only its OPEN edges merge — the first child into
 * the block holding the caret, the last into the block the tail ended up in.
 * The closed blocks between them materialize and are the remap half's
 * business.
 */
function mergedPasteSpots(tr: Transaction): { start: PasteSpot | null; end: PasteSpot | null } {
  const none = { start: null, end: null }
  for (let stepIndex = 0; stepIndex < tr.steps.length; stepIndex++) {
    const step = tr.steps[stepIndex]
    if (!(step instanceof ReplaceStep)) continue
    const { content, openStart, openEnd } = step.slice
    if (content.childCount === 0) continue
    const mapping = tr.mapping.slice(stepIndex + 1)

    let inlineOnly = true
    content.forEach((node) => {
      if (!node.isInline) inlineOnly = false
    })
    if (inlineOnly) {
      const text = content.textBetween(0, content.size, undefined, LEAF_PLACEHOLDER)
      // One paste, one landing — the first replace step is it.
      return { start: { pos: mapping.map(step.from, 1), text, atEnd: false }, end: null }
    }

    return {
      start:
        openStart > 0 && content.firstChild
          ? { pos: mapping.map(step.from, 1), text: contentString(content.firstChild), atEnd: false }
          : null,
      end:
        openEnd > 0 && content.childCount > 1 && content.lastChild
          ? {
              pos: mapping.map(step.from + step.slice.size, -1),
              text: contentString(content.lastChild),
              atEnd: true,
            }
          : null,
    }
  }
  return none
}

function extendEntriesForMergedPaste(
  doc: PMNode,
  comments: Map<string, SegmentEntry[]>,
  sourceUid: string,
  landing: { targetUid: string; text: string; offset: number },
): Set<string> {
  const source = nodeIdIndex(doc).byId.get(sourceUid)
  // The source is gone — that paste was a move, and a move extends nothing.
  if (!source || landing.targetUid === sourceUid) return new Set()
  const align = contentString(source.node).indexOf(landing.text)
  if (align === -1) return new Set()
  return extendComments(
    doc,
    comments,
    sourceUid,
    landing.targetUid,
    align,
    align + landing.text.length,
    landing.offset,
  )
}

/* ------------------------------------------------------------------------- *
 * CUT-CARRY — the third half of "the comment follows the text" (plan §6,
 * decision 5: "cut = move"). Cutting a WHOLE BLOCK is already free: its uid
 * leaves the document and reappears on paste, and the revival trigger
 * restores the highlight with zero traffic. Cutting TEXT is the gap this
 * closes — the node survives, so no uid ever moves; the range simply
 * collapses and the comment orphans. Pasting it back cannot go through the
 * copy halves either: they extend from LIVE segments, and there is nothing
 * live left.
 *
 * So the cut transaction (ProseMirror stamps `uiEvent: 'cut'`) records what
 * it took: the text, plus every comment range inside it as an offset and
 * length in that text's frame. The next paste whose content CONTAINS it
 * re-anchors those ranges onto wherever it landed. Session-scoped and
 * text-gated by construction: nothing revives unless the very characters
 * that were cut come back.
 * ------------------------------------------------------------------------- */

interface CutCarry {
  /** One entry per TEXTBLOCK the cut touched (a two-paragraph cut has two),
   *  each with the exact text taken from it (leaf-faithful, so chips count 1)
   *  and the comment ranges inside that text. The paste matches whichever
   *  block's text it brought back. */
  blocks: Array<{
    text: string
    ranges: Array<{ id: string; from: number; to: number }>
  }>
}

/**
 * What a cut took from the commented ranges — computed on the OLD document
 * (the transaction's mapping has not been applied to these positions yet).
 * Recorded PER TEXTBLOCK — a multi-block cut yields one entry per block —
 * because inside one block, position arithmetic IS character arithmetic; the
 * per-block clip is what absorbs the boundary tokens `textBetween` skips.
 * Whole-block cuts do not strictly need this (the uid revival already
 * restores them), but their blocks record too and the paste dedupes.
 */
function recordCutCarry(oldState: EditorState, prev: CommentSegmentsState): CutCarry | null {
  const { from, to } = oldState.selection
  if (from >= to) return null

  const blocks: CutCarry['blocks'] = []
  oldState.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true // descend — wrappers take nothing
    const base = pos + 1
    const start = Math.max(from, base)
    const end = Math.min(to, base + node.content.size)
    if (start >= end) return false
    const text = oldState.doc.textBetween(start, end, undefined, LEAF_PLACEHOLDER)
    if (text.length === 0) return false

    const ranges: CutCarry['blocks'][number]['ranges'] = []
    for (const [id, entries] of prev.comments) {
      for (const entry of entries) {
        if (!entry.live) continue
        const rangeStart = Math.max(entry.live.from, start)
        const rangeEnd = Math.min(entry.live.to, end)
        if (rangeStart >= rangeEnd) continue
        ranges.push({ id, from: rangeStart - start, to: rangeEnd - start })
      }
    }
    // Tombstoned comments cannot contribute: they have no live range to take.
    if (ranges.length > 0) blocks.push({ text, ranges })
    return false
  })
  return blocks.length > 0 ? { blocks } : null
}

/**
 * Re-anchor a cut's commented ranges onto the paste that brought the text
 * back. Scans every TEXTBLOCK the paste touched — merged edges AND
 * materialized blocks alike — for a block of the cut, matched by its exact
 * text. That breadth is what makes the four shapes of a paste one case:
 * whether the content landed inside an existing block or as a node of its
 * own, the evidence is the same characters coming back.
 *
 * Identity and geometry travel separately: the range binds to the matched
 * node's POSITION, and the uid is only recorded as the stored identity. A
 * node still holding a DUPLICATED uid (a pasted copy awaiting its re-mint)
 * is skipped for this apply — the carry window retries once the kernel's
 * appended transaction settles the identity, so `stored.id` is always the
 * unique, final uid.
 *
 * The carry survives repeated pastes (pasting a cut buffer twice duplicates
 * it, exactly like a copy), a tombstoned comment is resurrected here (its
 * text demonstrably returned — the same evidence every revival demands), and
 * a range already anchored at that exact spot is never added twice.
 */
function applyCutCarry(
  tr: Transaction,
  oldState: EditorState,
  doc: PMNode,
  comments: Map<string, SegmentEntry[]>,
  dropped: Map<string, SegmentEntry[]>,
  onResurrect: (id: string) => void,
  carry: CutCarry,
): Set<string> {
  const carried = new Set<string>()
  // The entries the cut killed are KEPT, flagged `moved`: they are the undo
  // seed. Dropping them (they are dormant, and dormant never travels)
  // silently broke undo — reverting cut+paste left the original text with no
  // anchor to revive from.
  const supersede = (entries: SegmentEntry[]) =>
    entries.map((candidate) => (candidate.live ? candidate : { ...candidate, moved: true }))

  const changes = getChangedRanges(combineTransactionSteps(oldState.doc, [tr]))
  const index = nodeIdIndex(doc)
  for (const { newRange } of changes) {
    for (const { node, pos } of findChildrenInRange(doc, newRange, (candidate) =>
      candidate.isTextblock,
    )) {
      const uid = node.attrs[NODE_ID_ATTRIBUTE] as unknown
      if (typeof uid !== 'string' || uid === '') continue
      // A duplicated uid is a pasted copy the NodeIds kernel has not re-minted
      // yet (its appended transaction lands later in this same dispatch).
      // Binding now would store an identity owned by the SURVIVING holder —
      // skip this node and let the carry-window retry bind after the re-mint,
      // when the uid is unique. Mirrors the merge half's landing defer.
      if (index.duplicated.has(uid)) continue
      const text = contentString(node)
      for (const block of carry.blocks) {
        const align = text.indexOf(block.text)
        if (align === -1) continue
        // The binding is the MATCHED node's own geometry — string indices are
        // content offsets under the placeholder norm, so the range needs no
        // re-resolution. Never round-trip through the uid index here: byId
        // keeps the FIRST holder in document order, which during a paste can
        // be the surviving remainder rather than this node.
        const base = pos + 1
        for (const range of block.ranges) {
          const stored: CommentNodeSegment = {
            id: uid,
            from: align + range.from,
            to: align + range.to,
          }
          const live = { from: base + stored.from, to: base + stored.to }
          const existing = comments.get(range.id)
          const tombstoned = dropped.get(range.id)
          const alreadyThere = (existing ?? tombstoned ?? []).some(
            (candidate) =>
              candidate.live &&
              candidate.stored.id === stored.id &&
              candidate.stored.from === stored.from &&
              candidate.stored.to === stored.to,
          )
          if (alreadyThere) continue
          const entry: SegmentEntry = { stored, live, moved: true }
          if (existing) {
            comments.set(range.id, [...supersede(existing), entry])
          } else if (tombstoned) {
            comments.set(range.id, [...supersede(tombstoned), entry])
            onResurrect(range.id)
          } else {
            continue
          }
          carried.add(range.id)
        }
      }
    }
  }
  return carried
}

/* ------------------------------------------------------------------------- *
 * The anchor reporter — the WRITE side of the anchor model
 * ------------------------------------------------------------------------- */

/**
 * The canonical anchor payload of a comment's CURRENT entries — the one
 * derivation every write shares (the reporter's ledger and the public
 * `payloadFor` seam alike): each live range re-derived from the doc it sits
 * in (`segmentsFromRange`, in entry order — normalization keeps the lives in
 * document order). DORMANT entries DO NOT TRAVEL (decided): every entry a
 * write ships is one the backend's quote validator can safely resolve, the
 * stored row self-cleans to exactly what is highlighted, and nothing
 * accumulates without bound. In-session revival is untouched — the plugin
 * state keeps the collapse snapshots; the one corner given up is reviving a
 * MIXED row's dormant segment across a reload.
 *
 * Null means only "nothing is live" (including lives that grazed just block
 * boundaries). What a null MEANS for the backend row is not decided here:
 * the ledger's `reportPayloadOf` adjudicates it — a PROVEN-dead anchor is
 * written as the empty payload so the row never outlives its text, and
 * everything unproven stays silent.
 */
function derivePayload(doc: PMNode, entries: SegmentEntry[]): CommentAnchorPayload | null {
  const nodes: CommentNodeSegment[] = []
  let quote = ''
  for (const entry of entries) {
    if (!entry.live) continue
    nodes.push(...segmentsFromRange(doc, entry.live.from, entry.live.to))
    // No block separator — matches textForSegments over the derived array,
    // and the offset norm: atoms/hardBreak count 1 position, quote nothing.
    quote += doc.textBetween(entry.live.from, entry.live.to)
  }
  return nodes.length === 0 ? null : { nodes, quote }
}

function payloadsEqual(a: CommentAnchorPayload, b: CommentAnchorPayload): boolean {
  if (a.quote !== b.quote || a.nodes.length !== b.nodes.length) return false
  return a.nodes.every((node, i) => {
    const other = b.nodes[i]
    return node.id === other.id && node.from === other.from && node.to === other.to
  })
}

/**
 * The DIRTY LEDGER behind the atomic save envelope (rodada 6) — no timers, no
 * sink, no queue. `applySegments` marks ids whose live geometry changed;
 * `sweep` (plugin view, once per dispatch) settles the picture against the
 * confirmed baselines (an edit undone within the cycle silences itself; a
 * dirty id with nothing live is adjudicated by `reportPayloadOf` — a
 * PROVEN-dead anchor writes the empty payload, anything unproven never
 * writes); `collect` derives the CURRENT canonical payloads for the envelope
 * without clearing anything; `confirm` lands the envelope's payloads as the
 * persisted truth — dirt that arrived after the collect stays dirty for the
 * next envelope. The consumer's save debounce is the only cadence.
 */
interface AnchorReporter {
  /** A comment's live geometry changed: mapped, coalesced, collapsed, revived. */
  markDirty(id: string): void
  /** An id was seeded from storage (membership) — the storage row is the last
   *  written truth, so it becomes the comparison baseline. NOT dirty. */
  noteSeeded(doc: PMNode, record: CommentAnchorRecord): void
  /** `documentReplaced`: every comment re-seeded from storage; the ledger
   *  starts clean against the fresh baselines. */
  reset(doc: PMNode, records: CommentAnchorRecord[]): void
  /** One pass after the dispatch settled (appendTransaction fixpoint):
   *  drop marked ids whose payload landed back on its baseline (or that have
   *  nothing live to write), notify the ledger listener on changes. */
  sweep(state: EditorState): void
  /** The envelope's anchors: CURRENT canonical payloads of every dirty id,
   *  derived from `state` — call it in the same synchronous frame as the doc
   *  snapshot. Read-only: nothing clears until {@link AnchorReporter.confirm}. */
  collect(state: EditorState): CommentAnchorReport[]
  /** The envelope carrying these payloads was confirmed saved: they become
   *  the baselines; ids whose CURRENT payload already drifted again stay
   *  dirty. */
  confirm(state: EditorState, reports: CommentAnchorReport[]): void
  /** Ids currently dirty — the `pendingSave` badge source. */
  dirtyIds(): string[]
  /** ONE tracked anchor's current canonical payload (null when nothing is
   *  live) — what a queued create's envelope entry is derived from. */
  payloadFor(state: EditorState, id: string): CommentAnchorPayload | null
  destroy(): void
}

function createAnchorReporter(storage: CommentsStorage): AnchorReporter {
  /** Ids whose anchors drifted from the confirmed baselines. */
  const dirty = new Set<string>()
  /** Per comment, the last payload CONFIRMED saved (seeded from storage when
   *  the comment arrives). A recompute landing back on it un-dirties the id —
   *  the undo-within-a-cycle silencer and the move-zero-traffic guarantee. */
  const lastReported = new Map<string, CommentAnchorPayload>()
  /** Ledger-change detector for the provider's badge re-derivation. */
  let lastPicture = ''

  const notifyLedger = () => {
    const picture = [...dirty].sort().join('|')
    if (picture === lastPicture) return
    lastPicture = picture
    storage.onAnchorLedgerChanged?.()
  }

  const payloadOf = (state: EditorState, id: string): CommentAnchorPayload | null => {
    const entries = commentSegmentsKey.getState(state)?.comments.get(id)
    return entries ? derivePayload(state.doc, entries) : null
  }

  /** The detach write. A factory, not a shared constant — reports and
   *  baselines cross the adapter seam and must never share `nodes` identity. */
  const emptyPayload = (): CommentAnchorPayload => ({ nodes: [], quote: '' })

  /**
   * The LEDGER's derivation — what sweep/collect/confirm adjudicate a dirty
   * id against. Three-valued:
   * - a LIVE payload: at least one range still holds (mixed rows stay
   *   live-only — dormants never travel);
   * - the EMPTY payload: the anchor is PROVEN dead — every entry (dormant in
   *   `comments` or tombstoned in `dropped`) carries a collapse snapshot and
   *   none of their stored addresses still resolves to it. Cut, type-over
   *   and paste-over land here; the write clears the row so the stored
   *   anchor never outlives the text it described.
   * - null: nothing to say. Unknown ids; ids with no entries in either map
   *   (teardown, pre-seed); any SNAPSHOTLESS entry (a seeded dormant — no
   *   snapshot is no proof of death: a drifted local doc must not erase a
   *   row that may be true for the saved one); and any entry whose stored
   *   address STILL resolves to its snapshot — a one-transaction move (drag,
   *   region normalize, cell merge) relocated the text intact, the row is
   *   still true, and erasing it would destroy a valid anchor.
   *
   * The public `payloadFor` seam deliberately keeps the LIVE-only
   * derivation: a queued create's doom check reads its truthiness, and an
   * empty payload is an object — truthy — that would ship a comment anchored
   * to nothing instead of cancelling it.
   */
  const reportPayloadOf = (state: EditorState, id: string): CommentAnchorPayload | null => {
    const live = payloadOf(state, id)
    if (live) return live
    if (!storage.comments.some((record) => record.id === id)) return null
    const segments = commentSegmentsKey.getState(state)
    const entries = segments?.comments.get(id) ?? segments?.dropped.get(id)
    if (!entries || entries.length === 0) return null
    for (const entry of entries) {
      if (entry.dormantText === undefined) return null
      if (textForSegments(state.doc, [entry.stored]) === entry.dormantText) return null
    }
    return emptyPayload()
  }

  const baseline = (doc: PMNode, record: CommentAnchorRecord): CommentAnchorPayload => ({
    nodes: record.nodes.map((node) => ({ ...node })),
    // A row already detached on the backend must baseline EQUAL to the empty
    // derivation, or a confirmed erasure could never settle across a reload.
    quote: record.nodes.length === 0 ? '' : (record.quote ?? textForSegments(doc, record.nodes)),
  })

  return {
    markDirty: (id) => {
      dirty.add(id)
    },
    noteSeeded: (doc, record) => {
      lastReported.set(record.id, baseline(doc, record))
      dirty.delete(record.id)
    },
    reset: (doc, records) => {
      dirty.clear()
      lastReported.clear()
      for (const record of records) lastReported.set(record.id, baseline(doc, record))
      notifyLedger()
    },
    sweep: (state) => {
      // An id gone from storage forgets everything — dirt and baseline (a
      // re-added id re-seeds fresh, mirroring the membership reconcile).
      const known = new Set(storage.comments.map((record) => record.id))
      for (const id of [...lastReported.keys()]) if (!known.has(id)) lastReported.delete(id)
      for (const id of [...dirty]) {
        if (!known.has(id)) {
          dirty.delete(id)
          continue
        }
        const payload = reportPayloadOf(state, id)
        // Nothing to adjudicate — unproven death, unseeded, or evicted from
        // the doc's maps: never written, not dirty. (Gone from STORAGE means
        // silence too, handled above; gone from the DOC means the empty
        // payload, and that one flows through the baseline compare below.)
        if (!payload) {
          dirty.delete(id)
          continue
        }
        const last = lastReported.get(id)
        if (last && payloadsEqual(payload, last)) dirty.delete(id)
      }
      notifyLedger()
    },
    collect: (state) => {
      const reports: CommentAnchorReport[] = []
      for (const id of [...dirty]) {
        const payload = reportPayloadOf(state, id)
        if (payload) reports.push({ id, ...payload })
      }
      return reports
    },
    confirm: (state, reports) => {
      for (const report of reports) {
        const saved: CommentAnchorPayload = { nodes: report.nodes, quote: report.quote }
        lastReported.set(report.id, saved)
        const current = reportPayloadOf(state, report.id)
        // Nothing to adjudicate anymore (evicted mid-flight, or the death
        // became unprovable): the saved baseline stands, nothing re-dirties.
        if (!current) continue
        // BOTH directions against the NEW baseline — what the envelope just
        // persisted. Equal: clean. Different: dirty, whichever way it drifted.
        // The delete-only version silently lost the UNDO case: an edit that
        // reverted to the OLD baseline while the envelope flew un-dirtied
        // itself in the sweep, and the persisted doc kept an anchor no
        // further envelope would ever correct.
        if (payloadsEqual(current, saved)) dirty.delete(report.id)
        else dirty.add(report.id)
      }
      notifyLedger()
    },
    dirtyIds: () => [...dirty],
    payloadFor: (state, id) => payloadOf(state, id),
    destroy: () => {
      dirty.clear()
    },
  }
}

/** Sum of live lengths — the "innermost" measure for anchor comments: the
 *  TOTAL covered length across all live ranges, NOT the hull. A two-segment
 *  comment's hull spans text it does not cover, and hull-innermost would let
 *  it beat a comment sitting entirely inside its gap. */
function totalLiveLength(entries: SegmentEntry[]): number {
  let total = 0
  for (const entry of entries) if (entry.live) total += entry.live.to - entry.live.from
  return total
}

/**
 * Disjoint segmentation over ALL comments' live ranges: cut at every range
 * boundary, one inline decoration per covered slice. The DOM contract:
 * `.comment` on every slice, `data-comment-id` = the innermost comment,
 * `data-comment-ids` = every covering id (the panel's scroll-target selector
 * `[data-comment-ids~=…]` reaches a fully covered comment that never wins
 * innermost on any slice). The active comment's slices add `comment--active`
 * here too — decorations are the ONLY comment paint, nothing nests.
 */
function buildDecorations(
  doc: PMNode,
  comments: Map<string, SegmentEntry[]>,
  activeId: string | null,
): DecorationSet {
  interface Boundary {
    pos: number
    delta: 1 | -1
    id: string
  }
  const boundaries: Boundary[] = []
  const totals = new Map<string, number>()
  for (const [id, entries] of comments) {
    for (const entry of entries) {
      if (!entry.live) continue
      boundaries.push({ pos: entry.live.from, delta: 1, id })
      boundaries.push({ pos: entry.live.to, delta: -1, id })
    }
    totals.set(id, totalLiveLength(entries))
  }
  if (boundaries.length === 0) return DecorationSet.empty
  // Closes sort before opens at the same position: ranges are end-exclusive,
  // so two ranges touching there share no character — a touch point must not
  // read as an overlap.
  boundaries.sort((a, b) => a.pos - b.pos || a.delta - b.delta)

  const decorations: Decoration[] = []
  const covering = new Set<string>()
  let sliceFrom = 0
  for (const boundary of boundaries) {
    if (covering.size > 0 && boundary.pos > sliceFrom) {
      // Deterministic id order: the comments map iterates in storage order.
      const ids = [...comments.keys()].filter((id) => covering.has(id))
      let innermost = ids[0]
      for (const id of ids) {
        if ((totals.get(id) ?? Infinity) < (totals.get(innermost) ?? Infinity)) innermost = id
      }
      let className = 'comment'
      if (ids.length > 1) className += ' comment--stacked'
      if (activeId !== null && covering.has(activeId)) className += ' comment--active'
      decorations.push(
        Decoration.inline(sliceFrom, boundary.pos, {
          class: className,
          'data-comment-id': innermost,
          'data-comment-ids': ids.join(' '),
        }),
      )
    }
    if (boundary.delta === 1) covering.add(boundary.id)
    else covering.delete(boundary.id)
    sliceFrom = boundary.pos
  }
  return DecorationSet.create(doc, decorations)
}

/**
 * The anchor state machine — one pass per transaction:
 *
 * 1. `documentReplaced` (stamped by `api.setJSON` on the swap transaction) →
 *    full re-seed of EVERY comment from storage, tombstones cleared. Mapping
 *    across a whole-doc replace collapses everything, so re-seeding must win
 *    over it — hence the early return.
 * 2. Map live ranges through the doc change with the classic bias pair
 *    `map(from, 1)` / `map(to, -1)` (typing at either edge lands OUTSIDE the
 *    highlight — non-inclusive edges). A collapse (`from >= to`) turns the
 *    segment dormant — refreshing its `stored` from the pre-collapse live
 *    geometry and snapshotting the covered text (`dormantText`).
 * 3. Revival — exactly three triggers, nothing else:
 *    (i)   a segment's uid REAPPEARS (absent from the previous doc, present
 *          now): cut+paste and programmatic re-insertion restore the
 *          highlight with zero traffic, offsets being move-invariant;
 *    (ii)  undo/redo (prosemirror-history's meta);
 *    (iii) `documentReplaced` (step 1).
 *    Every revival passes the TRUTH GATE: the re-resolve must land on the
 *    exact snapshotted text (seeded dormants, having no snapshot, revive
 *    only on reappearance — never on a bare history tick).
 *    Only segments already dormant BEFORE this transaction are eligible: a
 *    range this very transaction collapsed reflects a deletion it performed
 *    (a REDO of a delete carries the history meta too), and re-resolving it
 *    would repaint whatever text now occupies the stored offsets.
 * 3b. Copy-extend: a transaction carrying the uid kernel's remap meta grows
 *    every comment whose live segments intersect the copied content onto the
 *    pasted copy — see {@link extendEntriesForRemaps} (content alignment is
 *    also what separates a real copy from a split's remap).
 * 3c. Stored-uid death: a block-type conversion can re-mint a node's uid
 *    without moving a single live position (multi-block `setNode` births the
 *    blocks uid-less and the fill mints fresh — pinned in
 *    nodeIdsExtension.test.ts), so geometry dirt never fires while the stored
 *    anchor keeps naming a dead uid. Any LIVE segment whose `stored.id` left
 *    the doc dirties its comment: the reporter re-derives from the live range
 *    (`segmentsFromRange` reads the CURRENT uid at that position), so the
 *    report carries the new uid. Dormant entries are exempt — an absent
 *    stored id is what dormancy MEANS, and dirtying it would fight the
 *    revival machinery (and the dormant-verbatim passthrough).
 * 4. Tombstone (the anti-ghost rule): a comment whose LAST live ranges
 *    collapsed through mapping — nodes may survive, only the text is gone —
 *    is evicted and its id tombstoned. Ordinary typing must never re-resolve
 *    it; without the tombstone the membership reconcile below would re-seed
 *    it on the very next nudge and the highlight would resurrect over
 *    unrelated text.
 * 5. Membership reconcile against `storage.comments` (storage mutates outside
 *    the transaction stream; the nudge lands it here): new ids seed, ids gone
 *    from storage drop state AND tombstone (a re-added id starts fresh).
 * 6. Re-normalize touched comments (see `normalizeEntries`) and rebuild
 *    decorations only when something changed (doc, membership, active) —
 *    otherwise the DecorationSet instance is kept as-is.
 *
 * Along the way the pass FEEDS THE LEDGER (state changes are detected here;
 * the envelope derives payloads on demand): every id whose live geometry changed —
 * mapped, coalesced, collapsed, revived — is marked dirty, while
 * membership-only changes are seeded as baselines instead (a comment arriving
 * from storage IS the stored truth — reporting it back would be an echo).
 */
function applySegments(
  tr: Transaction,
  prev: CommentSegmentsState,
  oldState: EditorState,
  storage: CommentsStorage,
  reporter: AnchorReporter,
  consumePastedEdgeUids: () => PastedEdgeUids | null,
  clipboard: {
    noteCut: (carry: CutCarry | null) => void
    carry: () => CutCarry | null
    /** A paste happened while a cut buffer was live: try to re-anchor it on
     *  the next few applies too (blocks born now get their uid later). */
    openCarryWindow: () => void
    consumeCarryWindow: () => boolean
    notePending: (landings: PendingLanding[]) => void
    takePending: () => PendingLanding[]
  },
): CommentSegmentsState {
  const doc = tr.doc

  if (tr.getMeta(DOCUMENT_REPLACED_META)) {
    const comments = new Map<string, SegmentEntry[]>()
    for (const record of storage.comments) comments.set(record.id, seedEntries(doc, record))
    reporter.reset(doc, storage.comments)
    return {
      comments,
      dropped: new Map(),
      decorations: buildDecorations(doc, comments, storage.activeId),
      activeId: storage.activeId,
    }
  }

  let changed = false
  const comments = new Map<string, SegmentEntry[]>()
  const touched = new Set<string>()
  // Ids whose last live range collapsed under THIS transaction's mapping —
  // the tombstone candidates (step 4).
  const collapsedNow = new Set<string>()

  let dropped = prev.dropped
  const mutableDropped = () => {
    if (dropped === prev.dropped) dropped = new Map(prev.dropped)
    return dropped
  }

  // -- 2. map ---------------------------------------------------------------
  for (const [id, entries] of prev.comments) {
    if (!tr.docChanged) {
      comments.set(id, entries)
      continue
    }
    let hadLive = false
    let hasLive = false
    let mutated = false
    const mapped = entries.map((entry): SegmentEntry => {
      if (!entry.live) return entry
      hadLive = true
      const fromResult = tr.mapping.mapResult(entry.live.from, 1)
      const toResult = tr.mapping.mapResult(entry.live.to, -1)
      const from = fromResult.pos
      const to = toResult.pos
      // WIPED: everything the range covered was deleted — a paste (or typing)
      // OVER the commented text. The endpoints survive as boundaries, so the
      // biased map alone would let the range swallow whatever replaced it and
      // the comment would "cover" text nobody commented. The commented text
      // is gone: orphan it, exactly like a plain delete.
      const wiped = fromResult.deletedAfter && toResult.deletedBefore
      if (wiped || from >= to) {
        mutated = true
        // Collapse-time snapshot: refresh `stored` from the PRE-collapse live
        // geometry (the seed may predate edits the reporter already shipped)
        // and record the exact text it covered — revival's truth gate. A live
        // that grazed only block boundaries yields no segment: keep the seed,
        // snapshotless (it then revives only on uid reappearance).
        const [first] = segmentsFromRange(oldState.doc, entry.live.from, entry.live.to)
        if (!first) return { stored: entry.stored, live: null }
        return {
          ...entry,
          stored: first,
          live: null,
          dormantText: textForSegments(oldState.doc, [first]),
        }
      }
      if (from === entry.live.from && to === entry.live.to) {
        hasLive = true
        // Geometry-preserving content edits (same-length replacement:
        // spellcheck, IME, autocorrect) still change the QUOTE — dirty the
        // reporter even though no entry mutates, or the row's quote drifts
        // until the validator false-rejects a later write. QUOTE norm: the
        // artifact this protects is the shipped quote, and the placeholder
        // norm is blind to a leaf swapped for a literal space.
        if (
          doc.textBetween(from, to) !==
          oldState.doc.textBetween(entry.live.from, entry.live.to)
        ) {
          reporter.markDirty(id)
        }
        return entry
      }
      mutated = true
      hasLive = true
      return { ...entry, live: { from, to } }
    })
    if (hadLive && !hasLive) collapsedNow.add(id)
    if (mutated) {
      changed = true
      touched.add(id)
    }
    comments.set(id, mutated ? mapped : entries)
  }

  // -- 3. revival -----------------------------------------------------------
  // prosemirror-history dispatches undo/redo transactions with its own plugin
  // key as meta (`historyKey = new PluginKey("history")` and
  // `.setMeta(historyKey, …)` — prosemirror-history@1.5.0 dist/index.js, and
  // PluginKey("history") names its meta slot "history$" via prosemirror-state
  // createKey). Read the string so this file needs no import from a package
  // the SDK does not directly depend on; the slot is stable because the
  // bundle holds a single prosemirror-history instance.
  const history = Boolean(tr.getMeta('history$'))
  const storageById = new Map(storage.comments.map((record) => [record.id, record]))

  if (tr.docChanged || history) {
    const index = nodeIdIndex(doc)
    const oldIndex = tr.docChanged ? nodeIdIndex(oldState.doc) : index
    for (const [id, entries] of comments) {
      const prevEntries = prev.comments.get(id)
      if (!prevEntries) continue
      let mutated = false
      const revived = entries.map((entry, i): SegmentEntry => {
        if (entry.live !== null) return entry
        // Dormant BEFORE this transaction? (Arrays stay index-aligned with
        // prev — the mapping above is elementwise.)
        if (prevEntries[i]?.live !== null) return entry
        // Presence alone is NOT reappearance: after an in-block collapse the
        // uid never left, and resolving on mere presence would be the ghost.
        const reappeared =
          tr.docChanged && index.byId.has(entry.stored.id) && !oldIndex.byId.has(entry.stored.id)
        if (!history && !reappeared) return entry
        // Seeded dormants (no collapse snapshot) revive only on the strong
        // signal — their uid reappearing — never on a bare history tick.
        if (entry.dormantText === undefined && !reappeared) return entry
        const live = resolveSegment(doc, entry.stored)
        if (!live) return entry
        // The truth gate: a revival must land on EXACTLY the text that went
        // dormant, or it is the ghost (an unrelated undo over replacement
        // text, a stale seed after pre-dormancy drift). QUOTE norm on both
        // sides — the snapshot is textForSegments output, and comparing it
        // against the placeholder norm would refuse every range containing a
        // leaf (chip, hardBreak) forever.
        if (
          entry.dormantText !== undefined &&
          doc.textBetween(live.from, live.to) !== entry.dormantText
        ) {
          return entry
        }
        mutated = true
        return { stored: entry.stored, live } // revived: no longer superseded
      })
      if (mutated) {
        changed = true
        touched.add(id)
        comments.set(id, revived)
      }
    }
    // Tombstones resurrect from their COLLAPSE-TIME snapshot — never the
    // storage record: the snapshot carries the refreshed stored offsets and
    // the per-segment truth gate, so an unrelated undo over replacement text
    // stays dead while a genuine restoration matches and revives.
    for (const [id, snapshot] of prev.dropped) {
      if (!storageById.has(id)) continue // membership cleanup below owns it
      const reappeared =
        tr.docChanged &&
        snapshot.some(
          (entry) => index.byId.has(entry.stored.id) && !oldIndex.byId.has(entry.stored.id),
        )
      if (!history && !reappeared) continue
      let anyLive = false
      const entries = snapshot.map((entry): SegmentEntry => {
        const entryReappeared =
          tr.docChanged && index.byId.has(entry.stored.id) && !oldIndex.byId.has(entry.stored.id)
        if (entry.dormantText === undefined && !entryReappeared) return entry
        const live = resolveSegment(doc, entry.stored)
        if (!live) return entry
        // QUOTE norm, matching the snapshot's derivation (see the gate above).
        if (
          entry.dormantText !== undefined &&
          doc.textBetween(live.from, live.to) !== entry.dormantText
        ) {
          return entry
        }
        anyLive = true
        return { stored: entry.stored, live }
      })
      // Nothing anchors → hold the tombstone (an undo that did not bring the
      // text back must not soften the anti-ghost stance).
      if (!anyLive) continue
      changed = true
      comments.set(id, normalizeEntries(entries))
      mutableDropped().delete(id)
      // A revival is live geometry appearing — dirty like any other change
      // (the equal-to-baseline check silences the zero-traffic restorations).
      reporter.markDirty(id)
    }
  }

  // -- 3a½. remap revival: the copy of a CUT block ---------------------------
  // Cutting whole blocks usually frees their uids, and the paste restores
  // them (revival trigger i). But a cut that merges two partially-selected
  // blocks leaves an EMPTY SHELL still holding the first uid, so the pasted
  // copy collides and is re-minted — the uid never "reappeared", and without
  // this the comment stays orphaned on a paste that visibly brought its text
  // back. Same truth gate as every revival: the snapshot text must match.
  const remapMeta = tr.getMeta(UID_REMAPPED_META) as UidRemapMeta | undefined
  if (remapMeta && remapMeta.size > 0) {
    const reviveOnto = (entries: SegmentEntry[]): SegmentEntry[] | null => {
      let revived = false
      const next = entries.map((entry): SegmentEntry => {
        if (entry.live || entry.dormantText === undefined) return entry
        for (const [newUid, sourceUid] of remapMeta) {
          if (entry.stored.id !== sourceUid) continue
          const stored: CommentNodeSegment = { ...entry.stored, id: newUid }
          const live = resolveSegment(doc, stored)
          if (!live) continue
          // QUOTE norm — derived from the REMAPPED node's own resolved range
          // (never from entry.stored, which still names the shell the revival
          // is moving away from).
          if (doc.textBetween(live.from, live.to) !== entry.dormantText) {
            continue
          }
          revived = true
          return { stored, live }
        }
        return entry
      })
      return revived ? next : null
    }
    for (const [id, entries] of comments) {
      const revived = reviveOnto(entries)
      if (!revived) continue
      comments.set(id, revived)
      changed = true
      touched.add(id)
    }
    for (const [id, snapshot] of dropped) {
      if (!storageById.has(id)) continue
      const revived = reviveOnto(snapshot)
      if (!revived || !revived.some((entry) => entry.live)) continue
      comments.set(id, normalizeEntries(revived))
      mutableDropped().delete(id)
      changed = true
      touched.add(id)
    }
  }

  // -- 3b. copy-extend, remap half ------------------------------------------
  // The meta rides the uid kernel's APPENDED transaction (attribute-only
  // steps), so the live ranges mapped above are already valid in its doc.
  const remaps = tr.getMeta(UID_REMAPPED_META) as UidRemapMeta | undefined
  if (remaps && remaps.size > 0) {
    for (const id of extendEntriesForRemaps(doc, remaps, comments)) {
      changed = true
      touched.add(id) // normalize + markDirty below — the seed-shared path
    }
  }

  // -- 3b⅗. the cut buffer, retried while the kernel stamps ------------------
  const carry = clipboard.carry()
  if (carry && tr.docChanged && clipboard.consumeCarryWindow()) {
    const carried = applyCutCarry(tr, oldState, doc, comments, dropped, (id) => {
      mutableDropped().delete(id)
    }, carry)
    for (const id of carried) {
      changed = true
      touched.add(id)
    }
  }

  // -- 3b⅔. the deferred edge (the kernel stamps it a transaction later) ----
  const stillPending: PendingLanding[] = []
  for (const spot of clipboard.takePending()) {
    // Positions ride the mapping, so an intervening doc change (the trailing
    // paragraph the kernel appends) cannot shear them.
    const moved: PendingLanding = {
      ...spot,
      pos: tr.mapping.map(spot.pos, spot.atEnd ? -1 : 1),
      tries: spot.tries + 1,
    }
    const landing = landingAt(doc, moved)
    if (landing && landing.targetUid !== moved.sourceUid) {
      for (const id of extendEntriesForMergedPaste(doc, comments, moved.sourceUid, landing)) {
        changed = true
        touched.add(id)
      }
      continue
    }
    if (moved.tries < 4) stillPending.push(moved)
  }
  if (stillPending.length > 0) clipboard.notePending(stillPending)

  // -- 3b½. merged pastes: copy-extend + cut-carry ---------------------------
  // Open slices merged at a caret never reach the remap half (no node, no
  // collision). Identity for the COPY case rides the transformPasted latch,
  // consumed — and thereby cleared — on the FIRST doc change after it was
  // set: only the paste/drop dispatch immediately following transformPasted
  // may use it, and any other edit landing first proves that paste never
  // dispatched. The CUT case needs no latch: the buffer recorded at cut time
  // is matched by TEXT.
  const pastedEdges = tr.docChanged ? consumePastedEdgeUids() : null
  const uiEvent = tr.getMeta('uiEvent') as unknown
  // A drag MOVE is ONE transaction — ProseMirror deletes the dragged range
  // and inserts it at the drop point under a single 'drop' meta — so no cut
  // ever recorded a buffer for it. Record one here, from the same pre-state,
  // when this drop demonstrably deleted the old selection (the wiped pair,
  // exactly as the mapping pass reads a collapse). An EXTERNAL drop deletes
  // nothing (its old selection is unrelated) and an alt-drag COPY leaves the
  // source in place: both fail the guard and ride the copy-extend halves.
  // `noteCut` only on a real buffer — a null would clobber a cut still
  // waiting for its paste.
  if (uiEvent === 'drop' && tr.docChanged) {
    const { from, to } = oldState.selection
    const draggedAway =
      from < to &&
      tr.mapping.mapResult(from, 1).deletedAfter &&
      tr.mapping.mapResult(to, -1).deletedBefore
    if (draggedAway) {
      const dragCarry = recordCutCarry(oldState, prev)
      if (dragCarry) clipboard.noteCut(dragCarry)
    }
  }
  if (uiEvent === 'paste' || uiEvent === 'drop') {
    const spots = tr.docChanged ? mergedPasteSpots(tr) : { start: null, end: null }
    // Both open edges of the slice, each with its own source: a multi-block
    // copy merges its FIRST child into the caret's block and its LAST into
    // the tail's — the closed blocks between them go through the remap half.
    const pending: PendingLanding[] = []
    for (const edge of ['start', 'end'] as const) {
      const spot = spots[edge]
      const sourceUid = pastedEdges?.[edge] ?? null
      if (!spot || !sourceUid) continue
      const landing = landingAt(doc, spot)
      // DEFER when the landing block was born in THIS dispatch: it has either
      // no uid yet, or still the SOURCE's (a split copies the attrs over).
      // The NodeIds kernel stamps it in an APPENDED, attribute-only
      // transaction, so `pos` still means the same thing on the retry.
      if (!landing || landing.targetUid === sourceUid) {
        pending.push({ sourceUid, tries: 0, ...spot })
        continue
      }
      for (const id of extendEntriesForMergedPaste(doc, comments, sourceUid, landing)) {
        changed = true
        touched.add(id)
      }
    }
    if (pending.length > 0) clipboard.notePending(pending)
    // The cut buffer is matched by TEXT across every block the paste touched
    // — merged edges and materialized nodes alike. Blocks that ALREADY exist
    // (a merged edge) re-anchor right here; a block born in THIS dispatch has
    // no uid until the kernel stamps it, so the window below repeats the
    // attempt over the next few applies of the appendTransaction fixpoint.
    const pasteCarry = tr.docChanged ? clipboard.carry() : null
    if (pasteCarry) {
      const carried = applyCutCarry(tr, oldState, doc, comments, dropped, (id) => {
        mutableDropped().delete(id)
      }, pasteCarry)
      for (const id of carried) {
        changed = true
        touched.add(id)
      }
      clipboard.openCarryWindow()
    }
  }

  // -- 3b¾. the cut buffer ---------------------------------------------------
  // Recorded from the OLD state: what this cut took out of commented ranges,
  // so the paste that brings the text back can re-anchor it (plan §6's
  // "cut = move" for TEXT — whole blocks ride uid revival instead).
  if (uiEvent === 'cut' && tr.docChanged) clipboard.noteCut(recordCutCarry(oldState, prev))

  // -- 3c. stored-uid death → dirty (see the docstring) ---------------------
  // Re-checked on every doc change while the stored id stays dead (storage
  // catches up only after the report round-trips): the sweep's compare-to-
  // last-reported keeps the repeats silent, so the cost is one cached-index
  // lookup per live entry.
  if (tr.docChanged) {
    const index = nodeIdIndex(doc) // WeakMap-cached — the revival pass built it
    for (const [id, entries] of comments) {
      if (entries.some((entry) => entry.live !== null && !index.byId.has(entry.stored.id))) {
        reporter.markDirty(id)
      }
    }
  }

  // -- 4. tombstone ---------------------------------------------------------
  for (const id of collapsedNow) {
    const entries = comments.get(id)
    if (!entries || entries.some((entry) => entry.live)) continue
    comments.delete(id)
    mutableDropped().set(id, entries)
    changed = true
  }

  // -- 5. membership reconcile ---------------------------------------------
  for (const record of storage.comments) {
    if (comments.has(record.id) || dropped.has(record.id)) continue
    comments.set(record.id, seedEntries(doc, record))
    reporter.noteSeeded(doc, record)
    changed = true
  }
  for (const id of [...comments.keys()]) {
    if (storageById.has(id)) continue
    comments.delete(id)
    changed = true
  }
  for (const id of [...dropped.keys()]) {
    if (storageById.has(id)) continue
    mutableDropped().delete(id)
    changed = true
  }

  // -- 6. normalize + decorations -------------------------------------------
  for (const id of touched) {
    const entries = comments.get(id)
    if (entries) comments.set(id, normalizeEntries(entries))
    // Dirty even when since evicted (tombstone/membership): the sweep resolves
    // what a dirty id means against the FINAL state — gone from STORAGE means
    // silence, PROVEN gone from the doc means the empty write, and everything
    // else settles against its baseline.
    reporter.markDirty(id)
  }

  const activeChanged = prev.activeId !== storage.activeId
  if (!changed && !activeChanged && !tr.docChanged) return prev
  const decorations =
    changed || activeChanged || tr.docChanged
      ? buildDecorations(doc, comments, storage.activeId)
      : prev.decorations
  return { comments, dropped, decorations, activeId: storage.activeId }
}

/** Card-level anchor health of an anchor-model comment. 'orphaned' covers the
 *  tombstoned and the never-anchored alike — "no live range" is exactly what
 *  orphaned means, and the card persists either way (orphan-forever
 *  semantics). */
export type CommentAnchorState = 'anchored' | 'partial' | 'orphaned'

export function getCommentAnchorState(editor: Editor, id: string): CommentAnchorState {
  const all = commentSegmentsKey.getState(editor.state)?.comments.get(id)
  // The DORMANT end of a move is not a piece the comment lost (the text is
  // alive at the other end) — counting it would badge every cut+paste, and
  // every undo of one, as "partially detached".
  const entries = all?.filter((entry) => !(entry.live === null && entry.moved))
  if (!entries || entries.length === 0) return 'orphaned'
  const live = entries.filter((entry) => entry.live !== null).length
  if (live === 0) return 'orphaned'
  return live === entries.length ? 'anchored' : 'partial'
}

/** Where the comment starts in the CURRENT doc: the start of its FIRST live
 *  range in document order (the panel's jump target). Null while orphaned.
 *  Positions shift with every edit — derive fresh, never store. */
export function getCommentPosition(editor: Editor, id: string): number | null {
  const entries = commentSegmentsKey.getState(editor.state)?.comments.get(id)
  if (!entries) return null
  let first: number | null = null
  for (const entry of entries) {
    if (entry.live && (first === null || entry.live.from < first)) first = entry.live.from
  }
  return first
}

/**
 * The interaction kernel around the anchor comments, live in BOTH modes
 * (highlights are part of the review surface everywhere — review mode is only
 * where NEW comments happen). Two plugins, split by lifecycle:
 *
 * - the props-only kernel plugin: the draft emphasis (the range being
 *   composed) and the click arbiter reporting the innermost hit;
 * - the segments plugin: real plugin STATE for the anchors (resolve, map,
 *   tombstones/revival, decorations incl. active emphasis) — see
 *   {@link applySegments}.
 */
const CommentsKernel = Extension.create({
  // Storage is keyed by extension name — `getCommentsStorage` depends on it.
  name: 'comments',

  addStorage(): CommentsStorage {
    return {
      draft: null,
      activeId: null,
      onCommentClick: null,
      comments: [],
      collectDirtyAnchors: null,
      confirmAnchorsSaved: null,
      anchorPayloadFor: null,
      dirtyAnchorIds: null,
      onAnchorLedgerChanged: null,
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage as CommentsStorage
    // One ledger per editor, shared between the segments plugin's apply
    // (which marks changes) and its view (which sweeps and hosts the
    // envelope seams).
    const reporter = createAnchorReporter(storage)
    // The merge half of copy-extend needs the pasted fragment's SOURCE uid,
    // visible only on the pre-fit clipboard slice — transformPasted latches
    // it, the next paste/drop transaction consumes it. Overwritten on every
    // paste (foreign content latches null), so nothing stale survives.
    let pastedEdges: PastedEdgeUids | null = null
    // What the last cut took out of commented ranges, waiting for the paste
    // that brings it back (see CutCarry). A new cut replaces it; it survives
    // repeated pastes, which duplicate the text exactly like a copy would.
    let cutCarry: CutCarry | null = null
    // Edges whose landing block had no uid yet — consumed by the very next
    // apply (the kernel's attribute-only stamping transaction).
    let pendingLandings: PendingLanding[] = []
    // Applies still allowed to re-attempt the carry after a paste.
    let carryWindow = 0
    const clipboard = {
      noteCut: (carry: CutCarry | null) => {
        cutCarry = carry
        carryWindow = 0
      },
      carry: () => cutCarry,
      openCarryWindow: () => {
        carryWindow = 4
      },
      consumeCarryWindow: () => {
        if (carryWindow <= 0) return false
        carryWindow -= 1
        return true
      },
      notePending: (landings: PendingLanding[]) => {
        pendingLandings = landings
      },
      takePending: () => {
        const taken = pendingLandings
        pendingLandings = []
        return taken
      },
    }
    return [
      new Plugin({
        key: new PluginKey('commentsKernel'),
        props: {
          decorations: (state) => {
            if (!storage.draft) return null
            const max = state.doc.content.size
            const clamp = (pos: number) => Math.max(0, Math.min(pos, max))
            const from = clamp(storage.draft.from)
            const to = clamp(storage.draft.to)
            if (from >= to) return null
            return DecorationSet.create(state.doc, [
              Decoration.inline(from, to, { class: 'comment comment--draft' }),
            ])
          },
          // Clicking a highlight activates its comment in the panel (the
          // mirror of the panel's click-to-scroll); clicking plain text
          // deactivates. Never consumes the click — the caret still lands.
          handleClick: (view, pos) => {
            const notify = storage.onCommentClick
            if (!notify) return false
            // Overlaps: the INNERMOST comment wins — smallest TOTAL covered
            // length of its live ranges (see totalLiveLength).
            let hitId: string | null = null
            let hitSpan = Infinity
            const segments = commentSegmentsKey.getState(view.state)
            for (const [id, entries] of segments?.comments ?? []) {
              const hit = entries.some(
                // Half-open [from, to): a boundary between two adjacent
                // highlights belongs to the one STARTING there — end-inclusive
                // hit-testing let a click on a first character activate the
                // neighbour ending at that position.
                (entry) => entry.live && pos >= entry.live.from && pos < entry.live.to,
              )
              if (!hit) continue
              const span = totalLiveLength(entries)
              if (span < hitSpan) {
                hitId = id
                hitSpan = span
              }
            }
            notify(hitId)
            return false
          },
        },
      }),
      new Plugin<CommentSegmentsState>({
        key: commentSegmentsKey,
        state: {
          // Storage always starts at its defaults (empty list) when the state
          // is created — the first reconcile-on-apply seeds whatever the
          // bridge lands later.
          init: () => ({
            comments: new Map(),
            dropped: new Map(),
            decorations: DecorationSet.empty,
            activeId: null,
          }),
          apply: (tr, value, previousState) =>
            applySegments(
              tr,
              value,
              previousState,
              storage,
              reporter,
              () => {
                const edges = pastedEdges
                pastedEdges = null
                return edges
              },
              clipboard,
            ),
        },
        props: {
          decorations: (state) => commentSegmentsKey.getState(state)?.decorations ?? null,
          transformPasted: (slice) => {
            pastedEdges = pastedEdgeUids(slice)
            return slice
          },
        },
        // The ledger's clock: update() runs once per dispatch, AFTER the
        // appendTransaction fixpoint, and only settles WHICH ids are dirty.
        // Payloads are derived on demand by `collect`, inside the caller's
        // synchronous frame — nothing is ever held for later delivery.
        view: (view) => {
          // The envelope seams (see CommentsStorage) — live with the view
          // because they read the CURRENT editor state.
          storage.collectDirtyAnchors = () => reporter.collect(view.state)
          storage.confirmAnchorsSaved = (reports) => reporter.confirm(view.state, reports)
          storage.dirtyAnchorIds = () => reporter.dirtyIds()
          storage.anchorPayloadFor = (id) => reporter.payloadFor(view.state, id)
          return {
            update: (current) => reporter.sweep(current.state),
            destroy: () => {
              storage.collectDirtyAnchors = null
              storage.confirmAnchorsSaved = null
              storage.dirtyAnchorIds = null
              storage.anchorPayloadFor = null
              reporter.destroy()
            },
          }
        },
      }),
    ]
  },
})

/**
 * Anchor-based comments: nothing about a comment lives in the document.
 * Anchors are external `nodes[]` rows (uid + node-local offsets, see
 * commentAnchor.ts) resolved and mapped by the segments plugin; highlights
 * are DECORATIONS — never serialized, and provably zero-write in review mode.
 * The UI lives in
 * {@link CommentsLayer} (the review-only "Add comment" balloon — mount it in
 * BOTH modes; it is also the provider↔editor bridge) and {@link CommentsPanel}
 * (composer + cards), both fed by {@link CommentsProvider}.
 *
 * Contributes — extensions only (no bubble/insert items). Highlights render in
 * edit mode too; only COMPOSING a comment is review-mode-only.
 */
export const CommentsFeature = defineFeature({
  id: 'comments',
  extensions: () => [CommentsKernel],
})
