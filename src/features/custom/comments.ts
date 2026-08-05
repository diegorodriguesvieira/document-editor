import { defineFeature, Extension } from '../../editor'
import type { Editor } from '../../editor'
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
  /** The reporter's SINK ({@link CommentsLayer} injects the sync queue's
   *  enqueue): every debounced anchor report lands here — a queue boundary,
   *  never the network (the consumer's save pump flushes the queue only after
   *  the document save confirms). Null drops reports silently (no provider,
   *  or an adapter without `updateAnchor`). */
  onAnchorReport: ((report: CommentAnchorReport) => void) | null
  /** Set by the segments plugin's view: delivers every report still inside
   *  the debounce window into the sink NOW. The save pump calls it (through
   *  the bridge) right before draining the queue — without it the trailing
   *  edits of a burst miss their own save cycle (report debounce > save
   *  debounce) and strand in `pendingSave` until the NEXT save. */
  flushPendingReports: (() => void) | null
  /** Notified when the reporter RESETS on `documentReplaced`: every queued
   *  anchor write describes the document that just left — the bridge clears
   *  the sync queue here. */
  onAnchorsReset: (() => void) | null
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
      merged.push({ stored: entry.stored, live: { ...entry.live } })
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

/**
 * The merge half's SOURCE detector, run on the PRE-FIT clipboard slice inside
 * `transformPasted`: the fitter strips a merged fragment down to bare inline
 * content before the step is built (pinned in commentCopyExtend.test.ts), so
 * the source node's uid is visible ONLY here. Descends single-child open
 * wrappers (a copy out of a list arrives wrapped in its context) to the one
 * open textblock; anything else — multi-block copies, closed slices — is the
 * remap half's territory and latches nothing.
 */
function pastedSourceUidOf(slice: Slice): string | null {
  if (slice.openStart === 0 || slice.content.childCount !== 1) return null
  let node = slice.content.firstChild
  while (node && !node.isTextblock && node.childCount === 1) node = node.firstChild
  if (!node?.isTextblock) return null
  const uid = node.attrs[NODE_ID_ATTRIBUTE] as unknown
  return typeof uid === 'string' && uid !== '' ? uid : null
}

/**
 * COPY-EXTEND, merge half (plan §6, the partial-copy rule): a text selection
 * copied and pasted at a caret travels as an OPEN slice that MERGES into the
 * target textblock — no node is born, no uid collides, the remap half never
 * fires. Identity comes from the {@link pastedSourceUidOf} latch; geometry
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
 *   text extends nothing (the delete collapsed the segment first), while an
 *   alt-drag COPY extends. Cut text stays dead: anti-ghost holds.
 * - The open EDGE blocks of a multi-block copy stay uncovered (they never
 *   latch) — accepted; their closed middles still extend via the remap half.
 */
function extendEntriesForMergedPaste(
  tr: Transaction,
  doc: PMNode,
  comments: Map<string, SegmentEntry[]>,
  sourceUid: string,
): Set<string> {
  const extended = new Set<string>()
  const index = nodeIdIndex(doc)
  const source = index.byId.get(sourceUid)
  if (!source) return extended // the source is gone — that paste was a move

  for (let stepIndex = 0; stepIndex < tr.steps.length; stepIndex++) {
    const step = tr.steps[stepIndex]
    if (!(step instanceof ReplaceStep)) continue
    const { content } = step.slice
    let inlineOnly = content.childCount > 0
    content.forEach((node) => {
      if (!node.isInline) inlineOnly = false
    })
    if (!inlineOnly) continue
    const copyText = content.textBetween(0, content.size, undefined, LEAF_PLACEHOLDER)
    if (copyText.length === 0) continue

    // Where the merged text landed in the FINAL doc: inline content begins
    // exactly at the step's `from`; later steps' maps carry it forward.
    const from = tr.mapping.slice(stepIndex + 1).map(step.from, 1)
    const $from = doc.resolve(from)
    const target = $from.parent
    if (!target.isTextblock) continue
    const targetUid = target.attrs[NODE_ID_ATTRIBUTE] as unknown
    if (typeof targetUid !== 'string' || targetUid === '' || targetUid === sourceUid) continue

    const align = contentString(source.node).indexOf(copyText)
    if (align === -1) continue

    return extendComments(
      doc,
      comments,
      sourceUid,
      targetUid,
      align,
      align + copyText.length,
      $from.parentOffset, // one latch, one paste — the first inline step is it
    )
  }
  return extended
}

/* ------------------------------------------------------------------------- *
 * The anchor reporter — the WRITE side of the anchor model
 * ------------------------------------------------------------------------- */

/** Trailing debounce per comment between "live geometry changed" and the
 *  report leaving for the sink — long enough to swallow a typing burst (and
 *  an undo inside the window), short enough that the consumer's save pump
 *  usually finds the report already queued. Exported for tests. */
export const ANCHOR_REPORT_DEBOUNCE_MS = 800

/**
 * The canonical anchor payload of a comment's CURRENT entries — the one
 * derivation every write shares (the reporter, {@link deriveAnchorPayload}
 * for retries): each live range re-derived from the doc it sits in
 * (`segmentsFromRange`, in entry order — normalization keeps the lives in
 * document order). DORMANT entries DO NOT TRAVEL (decided): every entry a
 * write ships is one the backend's quote validator can safely resolve, the
 * stored row self-cleans to exactly what is highlighted, and nothing
 * accumulates without bound. In-session revival is untouched — the plugin
 * state keeps the collapse snapshots; the one corner given up is reviving a
 * MIXED row's dormant segment across a reload.
 *
 * Null when nothing is live (or the lives graze only block boundaries):
 * writing then would ship `nodes: []` — destroying the stored anchor an
 * all-dormant comment still revives from — so it is simply never reported.
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

/** The seams {@link applySegments} feeds the reporter through — state changes
 *  are detected where they happen (apply), but TIMING stays out of apply: the
 *  plugin view's update()/destroy() own the debounce and delivery. */
interface AnchorReporter {
  /** A comment's live geometry changed: mapped, coalesced, collapsed, revived. */
  markDirty(id: string): void
  /** An id was seeded from storage (membership) — the storage row is the last
   *  written truth, so it becomes the comparison baseline. NOT dirty. */
  noteSeeded(doc: PMNode, record: CommentAnchorRecord): void
  /** `documentReplaced`: every comment re-seeded from storage. Pendings were
   *  computed against the replaced doc — dropped, never delivered (the
   *  consumer's pump flushes anchors BEFORE swapping documents). */
  reset(doc: PMNode, records: CommentAnchorRecord[]): void
  /** One pass after the dispatch settled (appendTransaction fixpoint):
   *  recompute every dirtied comment's payload SYNCHRONOUSLY, schedule/cancel
   *  its trailing debounce. Only delivery is deferred. */
  sweep(state: EditorState): void
  /** Deliver every pending (debounced) report into the sink NOW — the save
   *  pump's pre-drain step (plan §7: payloads are "recomputed from live state
   *  at flush time", and these were). */
  flushPending(): void
  /** View teardown: pending reports deliver synchronously — the sink is a
   *  queue, not the network, so this loses nothing and blocks nothing. */
  destroy(): void
}

function createAnchorReporter(storage: CommentsStorage): AnchorReporter {
  /** Ids whose live geometry changed since the last sweep — grows across the
   *  applies of one dispatch (main transaction + appended), drained by sweep. */
  const dirty = new Set<string>()
  /** Per comment, the last payload ACTUALLY DELIVERED to the sink (seeded
   *  from storage when the comment arrives). Lives outside the debounce: a
   *  recompute that lands back on it cancels the pending report — that is the
   *  undo-within-the-window silencer and the move-zero-traffic guarantee. */
  const lastReported = new Map<string, CommentAnchorPayload>()
  const pending = new Map<
    string,
    { payload: CommentAnchorPayload; timer: ReturnType<typeof setTimeout> }
  >()

  const cancel = (id: string) => {
    const entry = pending.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(id)
  }

  const deliver = (id: string) => {
    const entry = pending.get(id)
    if (!entry) return
    clearTimeout(entry.timer) // no-op when the timer itself delivers
    pending.delete(id)
    const sink = storage.onAnchorReport
    // No sink → dropped silently; lastReported stays put, so the next dirty
    // recompute still differs and re-schedules once a sink exists.
    if (!sink) return
    lastReported.set(id, entry.payload)
    sink({ id, ...entry.payload })
  }

  const baseline = (doc: PMNode, record: CommentAnchorRecord): CommentAnchorPayload => ({
    nodes: record.nodes.map((node) => ({ ...node })),
    quote: record.quote ?? textForSegments(doc, record.nodes),
  })

  return {
    markDirty: (id) => {
      dirty.add(id)
    },
    noteSeeded: (doc, record) => {
      lastReported.set(record.id, baseline(doc, record))
      cancel(record.id)
    },
    reset: (doc, records) => {
      dirty.clear()
      for (const id of [...pending.keys()]) cancel(id)
      lastReported.clear()
      for (const record of records) lastReported.set(record.id, baseline(doc, record))
      // Queued writes describe the replaced document — the bridge drops them.
      storage.onAnchorsReset?.()
    },
    sweep: (state) => {
      // An id gone from storage forgets everything — pending report, timer,
      // baseline (a re-added id re-seeds fresh, mirroring the membership
      // reconcile's "starts fresh" rule).
      const known = new Set(storage.comments.map((record) => record.id))
      for (const id of [...pending.keys()]) if (!known.has(id)) cancel(id)
      for (const id of [...lastReported.keys()]) if (!known.has(id)) lastReported.delete(id)
      if (dirty.size === 0) return
      const segments = commentSegmentsKey.getState(state)
      for (const id of dirty) {
        if (!known.has(id)) continue
        const entries = segments?.comments.get(id)
        const payload = entries ? derivePayload(state.doc, entries) : null
        // All-dormant, tombstoned or evicted: never reported — and a pending
        // payload computed before the collapse is stale now, so it dies too.
        if (!payload) {
          cancel(id)
          continue
        }
        const last = lastReported.get(id)
        if (last && payloadsEqual(payload, last)) {
          cancel(id)
          continue
        }
        // Trailing debounce: a fresh payload restarts the comment's window.
        cancel(id)
        const timer = setTimeout(() => deliver(id), ANCHOR_REPORT_DEBOUNCE_MS)
        pending.set(id, { payload, timer })
      }
      dirty.clear()
    },
    flushPending: () => {
      for (const id of [...pending.keys()]) deliver(id)
    },
    destroy: () => {
      dirty.clear()
      for (const id of [...pending.keys()]) deliver(id)
    },
  }
}

/**
 * The reporter's derivation, on demand — what a manual RETRY must send: the
 * canonical `nodes[]` + `quote` for `id` as of the CURRENT doc, never a
 * stored or previously-failed payload. Null when the id is unknown to the
 * plugin or nothing is live (an all-dormant anchor is never written).
 */
export function deriveAnchorPayload(editor: Editor, id: string): CommentAnchorPayload | null {
  const entries = commentSegmentsKey.getState(editor.state)?.comments.get(id)
  if (!entries) return null
  return derivePayload(editor.state.doc, entries)
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
 * Along the way the pass FEEDS THE REPORTER (state changes are detected here;
 * timing lives in the plugin view): every id whose live geometry changed —
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
  consumePastedSourceUid: () => string | null,
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
      const from = tr.mapping.map(entry.live.from, 1)
      const to = tr.mapping.map(entry.live.to, -1)
      if (from >= to) {
        mutated = true
        // Collapse-time snapshot: refresh `stored` from the PRE-collapse live
        // geometry (the seed may predate edits the reporter already shipped)
        // and record the exact text it covered — revival's truth gate. A live
        // that grazed only block boundaries yields no segment: keep the seed,
        // snapshotless (it then revives only on uid reappearance).
        const [first] = segmentsFromRange(oldState.doc, entry.live.from, entry.live.to)
        if (!first) return { stored: entry.stored, live: null }
        return {
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
        // until the validator false-rejects a later write.
        if (
          doc.textBetween(from, to, undefined, LEAF_PLACEHOLDER) !==
          oldState.doc.textBetween(entry.live.from, entry.live.to, undefined, LEAF_PLACEHOLDER)
        ) {
          reporter.markDirty(id)
        }
        return entry
      }
      mutated = true
      hasLive = true
      return { stored: entry.stored, live: { from, to } }
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
        // text, a stale seed after pre-dormancy drift).
        if (
          entry.dormantText !== undefined &&
          doc.textBetween(live.from, live.to, undefined, LEAF_PLACEHOLDER) !== entry.dormantText
        ) {
          return entry
        }
        mutated = true
        return { stored: entry.stored, live }
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
        if (
          entry.dormantText !== undefined &&
          doc.textBetween(live.from, live.to, undefined, LEAF_PLACEHOLDER) !== entry.dormantText
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

  // -- 3b½. copy-extend, merge half -----------------------------------------
  // Open slices merged at a caret never reach the remap half (no node, no
  // collision). Identity rides the transformPasted latch, consumed — and
  // thereby cleared — on the FIRST doc change after it was set: only the
  // paste/drop dispatch immediately following transformPasted may use it, and
  // any other edit landing first proves that paste never dispatched.
  const pastedSourceUid = tr.docChanged ? consumePastedSourceUid() : null
  const uiEvent = tr.getMeta('uiEvent') as unknown
  if (pastedSourceUid && (uiEvent === 'paste' || uiEvent === 'drop')) {
    for (const id of extendEntriesForMergedPaste(tr, doc, comments, pastedSourceUid)) {
      changed = true
      touched.add(id)
    }
  }

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
    // what a dirty id means against the FINAL state — gone means silence.
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
  const entries = commentSegmentsKey.getState(editor.state)?.comments.get(id)
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
      onAnchorReport: null,
      flushPendingReports: null,
      onAnchorsReset: null,
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage as CommentsStorage
    // One reporter per editor, shared between the segments plugin's apply
    // (which detects changes) and its view (which owns the debounce timers).
    const reporter = createAnchorReporter(storage)
    // The merge half of copy-extend needs the pasted fragment's SOURCE uid,
    // visible only on the pre-fit clipboard slice — transformPasted latches
    // it, the next paste/drop transaction consumes it. Overwritten on every
    // paste (foreign content latches null), so nothing stale survives.
    let pastedSourceUid: string | null = null
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
            applySegments(tr, value, previousState, storage, reporter, () => {
              const uid = pastedSourceUid
              pastedSourceUid = null
              return uid
            }),
        },
        props: {
          decorations: (state) => commentSegmentsKey.getState(state)?.decorations ?? null,
          transformPasted: (slice) => {
            pastedSourceUid = pastedSourceUidOf(slice)
            return slice
          },
        },
        // The reporter's clock: update() runs once per dispatch, AFTER the
        // appendTransaction fixpoint — payloads are computed synchronously
        // there (never from a stale doc), only delivery is debounced. destroy
        // flushes what is pending straight into the sink.
        view: () => {
          // The save pump's pre-drain hook (see CommentsStorage) — lives with
          // the view because the reporter's timers do.
          storage.flushPendingReports = () => reporter.flushPending()
          return {
            update: (view) => reporter.sweep(view.state),
            destroy: () => {
              storage.flushPendingReports = null
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
 * Documents saved by the RETIRED mark model still carry `comment` marks;
 * run them through `stripCommentMarks` before loading (the mark is gone from
 * the schema, so a legacy doc throws otherwise). The UI lives in
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
