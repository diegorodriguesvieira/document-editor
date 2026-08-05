import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import { parseSliceFromHTML, renderEditor } from '../../test/editorHarness'
import { HistoryFeature } from '../history'
import { VariableFeature } from './variable'
// Deliberate deep import: the remap meta stays SDK-internal, and this suite is
// exactly the consumer contract it exists for.
import { UID_REMAPPED_META, type UidRemapMeta } from '../../editor/core/nodeIdsExtension'
import { textForSegments } from './commentAnchor'
import {
  ANCHOR_REPORT_DEBOUNCE_MS,
  CommentsFeature,
  getCommentsStorage,
  type CommentAnchorRecord,
} from './comments'

/* Fixtures carry EXPLICIT uids so segments are deterministic — injectNodeIds
 * keeps unique explicit ids verbatim on the way in. */
const paragraph = (uid: string, text: string): JSONContent => ({
  type: 'paragraph',
  attrs: { uid },
  content: [{ type: 'text', text }],
})
const docOf = (...blocks: JSONContent[]): { doc: JSONContent } => ({
  doc: { type: 'doc', content: blocks },
})

/** The storage+nudge idiom: land the anchor list in storage, then dispatch a
 *  no-op so the plugin's membership reconcile sees it. */
function seedComments(editor: Editor, comments: CommentAnchorRecord[]) {
  getCommentsStorage(editor)!.comments = comments
  editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
}

/** What CommentsLayer does with the provider's queue: a sink in storage. */
function attachSink(editor: Editor) {
  const sink = vi.fn()
  getCommentsStorage(editor)!.onAnchorReport = sink
  return sink
}

/** Every remap meta the editor emits from now on — the meta rides the uid
 *  kernel's APPENDED transaction, so root and appended are inspected alike.
 *  Copy-extend tests use it to prove a remap actually fired (or that a fired
 *  remap was deliberately ignored). */
function captureRemaps(editor: Editor): UidRemapMeta[] {
  const remaps: UidRemapMeta[] = []
  editor.on('transaction', ({ transaction, appendedTransactions }) => {
    for (const candidate of [transaction, ...appendedTransactions]) {
      const meta = candidate.getMeta(UID_REMAPPED_META) as UidRemapMeta | undefined
      if (meta) remaps.push(meta)
    }
  })
  return remaps
}

const spanTexts = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('span.comment')].map((span) => span.textContent)

/** Well past one debounce window — "nothing else ever fires" assertions. */
const LONG_AFTER = ANCHOR_REPORT_DEBOUNCE_MS * 5

describe('copy-extend (plan §6, decision 5 — the comment follows the copy)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('full-block copy: the comment gains a segment on the copy with IDENTICAL offsets', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // The paste-duplicate shape: the same node JSON, SAME uid, source still
    // present → collision → the copy re-mints and the remap meta feeds the
    // extend.
    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size,
      paragraph('p1', 'hello world'),
    )
    const copyUid = created.editor.state.doc.child(1).attrs.uid as string
    expect(copyUid).not.toBe('p1')

    // The highlight follows the copy IMMEDIATELY — extension is plugin state,
    // not a round-trip through the report.
    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      nodes: [
        { id: 'p1', from: 0, to: 5 },
        { id: copyUid, from: 0, to: 5 },
      ],
      quote: 'hellohello',
    })
  })

  it('partial copy: the copy gets exactly the INTERSECTION, shifted to its own frame', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // A partial copy's slice keeps the block attrs — the pasted node carries
    // the source uid over a SUBSTRING ('lo world' aligns at source offset 3),
    // overlapping the commented [0, 5) only on [3, 5).
    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size,
      paragraph('p1', 'lo world'),
    )
    const copyUid = created.editor.state.doc.child(1).attrs.uid as string

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      // [3, 5) in the source frame → [0, 2) in the copy's: 'lo'.
      nodes: [
        { id: 'p1', from: 0, to: 5 },
        { id: copyUid, from: 0, to: 2 },
      ],
      quote: 'hellolo',
    })
  })

  it('no-overlap copy: the remap fires but the comment stays put — no extend, no report', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    const remaps = captureRemaps(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // 'world' aligns at source offset 6 — entirely OUTSIDE the commented
    // [0, 5): the collision re-mints (remap observed), the intersection is
    // empty, nothing extends.
    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size,
      paragraph('p1', 'world'),
    )
    expect(remaps).toHaveLength(1)

    expect(spanTexts(created.editor)).toEqual(['hello'])
    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).not.toHaveBeenCalled()
  })

  it('chip alignment: atoms count 1 in the aligned frame — offsets stay atom-correct', () => {
    const chip: JSONContent = {
      type: 'variable',
      attrs: { id: 'client.name', label: 'Client name', uid: 'chip-1' },
    }
    const created = renderEditor([VariableFeature, CommentsFeature], {
      content: docOf({
        type: 'paragraph',
        attrs: { uid: 'p1' },
        content: [{ type: 'text', text: 'ab ' }, chip, { type: 'text', text: ' cd' }],
      }),
    })
    const sink = attachSink(created.editor)
    // Local offsets: a(0) b(1) ' '(2) chip(3) ' '(4) c(5) d(6) — the comment
    // covers [1, 6), chip inside, quoting 'b  c' (the chip quotes nothing).
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 1, to: 6 }] }])

    // Paste the chip-leading TAIL of the block (chip + ' cd', source uids kept
    // — the chip's own remap pair is skipped on empty content). With the
    // placeholder-faithful alignment the copy lands at source offset 3; a
    // textContent alignment would be one short and shear the intersection.
    created.editor.commands.insertContentAt(created.editor.state.doc.content.size, {
      type: 'paragraph',
      attrs: { uid: 'p1' },
      content: [chip, { type: 'text', text: ' cd' }],
    })
    const copyUid = created.editor.state.doc.child(1).attrs.uid as string
    expect(copyUid).not.toBe('p1')

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    // Intersection [3, 6) in the source frame → [0, 3) on the copy: chip,
    // ' ', 'c'.
    const expectedNodes = [
      { id: 'p1', from: 1, to: 6 },
      { id: copyUid, from: 0, to: 3 },
    ]
    expect(sink).toHaveBeenCalledWith({ id: 'c-1', nodes: expectedNodes, quote: 'b  c c' })
    // Golden-vector style: re-reading the reported segments off the doc
    // reproduces the quote — offsets and atom widths agree end to end.
    expect(textForSegments(created.editor.state.doc, expectedNodes)).toBe('b  c c')
  })

  it('split does NOT double-extend: the recorded remap misses alignment, live mapping wins', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'helloworld')),
    })
    const sink = attachSink(created.editor)
    const remaps = captureRemaps(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 10 }] }])

    // Mid-block split: the second half re-mints AND records a remap (the
    // collision rule cannot tell split from paste). The halves partition the
    // text, so 'hello'.indexOf('world') misses and the extend skips the pair.
    created.editor.view.dispatch(created.editor.state.tr.split(6))
    const secondUid = created.editor.state.doc.child(1).attrs.uid as string
    expect(secondUid).not.toBe('p1')
    expect(remaps).toHaveLength(1)
    expect(remaps[0]?.get(secondUid)).toBe('p1')

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    // Exactly the plain split expectation (commentReporter.test.ts): two
    // segments from live mapping — a double-extend would smuggle a third.
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      nodes: [
        { id: 'p1', from: 0, to: 5 },
        { id: secondUid, from: 0, to: 5 },
      ],
      quote: 'helloworld',
    })
  })

  it('double paste extends twice: three segments, unique uids, ONE coalesced report', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    const clipboard = paragraph('p1', 'hello world')
    created.editor.commands.insertContentAt(created.editor.state.doc.content.size, clipboard)
    created.editor.commands.insertContentAt(created.editor.state.doc.content.size, clipboard)
    const firstUid = created.editor.state.doc.child(1).attrs.uid as string
    const secondUid = created.editor.state.doc.child(2).attrs.uid as string
    expect(new Set(['p1', firstUid, secondUid]).size).toBe(3)

    // Both pastes land inside one debounce window — the trailing report
    // carries the full three-segment anchor in document order.
    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      nodes: [
        { id: 'p1', from: 0, to: 5 },
        { id: firstUid, from: 0, to: 5 },
        { id: secondUid, from: 0, to: 5 },
      ],
      quote: 'hellohellohello',
    })
  })

  it('REAL pipeline — pasted text that MERGES into another block extends onto the TARGET node', () => {
    // The dominant gesture: select text, ⌘C, ⌘V at a caret. The clipboard is
    // an OPEN slice (data-pm-slice) that merges into the target block — no
    // node is born, no uid collides, so this exercises the merge half of
    // copy-extend, not the remap half.
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Caret at the end of p2 (13 for p1's nodeSize + 1 into p2 + 8 chars).
    created.editor.commands.setTextSelection(22)
    // What serializeForClipboard produces for a partial copy of 'llo wo':
    // the open paragraph keeps the source block's data-uid.
    const pasteEvent = new Event('paste') as ClipboardEvent // jsdom has no ClipboardEvent
    created.editor.view.pasteHTML('<p data-pm-slice="1 1 []" data-uid="p1">llo wo</p>', pasteEvent)

    // 'llo wo' aligns at source offset 2, window [2, 8) ∩ commented [0, 5)
    // = [2, 5) 'llo' → target-local [8, 11) in p2. Highlight is immediate.
    expect(spanTexts(created.editor)).toEqual(['hello', 'llo'])

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      nodes: [
        { id: 'p1', from: 0, to: 5 },
        { id: 'p2', from: 8, to: 11 },
      ],
      quote: 'hellollo',
    })
  })

  it('REAL pipeline — pasting the same clipboard twice accumulates one segment per paste', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    const pasteEvent = new Event('paste') as ClipboardEvent
    const clipboard = '<p data-pm-slice="1 1 []" data-uid="p1">llo wo</p>'
    created.editor.commands.setTextSelection(22)
    created.editor.view.pasteHTML(clipboard, pasteEvent)
    // The caret lands after the pasted text — the second paste is contiguous.
    created.editor.view.pasteHTML(clipboard, pasteEvent)

    expect(spanTexts(created.editor)).toEqual(['hello', 'llo', 'llo'])

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      nodes: [
        { id: 'p1', from: 0, to: 5 },
        { id: 'p2', from: 8, to: 11 },
        { id: 'p2', from: 14, to: 17 },
      ],
      quote: 'hellollollo',
    })
  })

  it('REAL pipeline — pasted text with no commented overlap extends nothing', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.commands.setTextSelection(22)
    const pasteEvent = new Event('paste') as ClipboardEvent
    // ' world' aligns at source offset 5 — entirely outside the commented [0, 5).
    created.editor.view.pasteHTML('<p data-pm-slice="1 1 []" data-uid="p1"> world</p>', pasteEvent)

    expect(spanTexts(created.editor)).toEqual(['hello'])
    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).not.toHaveBeenCalled()
  })

  it('REAL pipeline — a merged paste never revives CUT text (anti-ghost holds for the merge half)', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Cut the commented text: the live range collapses (text-level moves are
    // not the node-level free move — this is the documented trade-off) …
    created.editor.commands.deleteRange({ from: 1, to: 6 })
    expect(spanTexts(created.editor)).toEqual([])

    // … so pasting it back INTO another block extends nothing: only LIVE
    // segments feed the merge half, exactly like the remap half.
    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    const pasteEvent = new Event('paste') as ClipboardEvent
    created.editor.view.pasteHTML('<p data-pm-slice="1 1 []" data-uid="p1">hello</p>', pasteEvent)
    expect(spanTexts(created.editor)).toEqual([])
  })

  it('undo after the flush sheds the copy segment from the ROW — redo re-extends live', () => {
    // Plan §6 (assumed consequences) and §10.3, under the live-only write
    // rule: undo of the paste AFTER the report was delivered leaves the copy
    // segment dormant IN SESSION (plugin state, redo revives it), while the
    // follow-up report self-cleans the row back to the live segment only.
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size,
      paragraph('p1', 'hello world'),
    )
    const copyUid = created.editor.state.doc.child(1).attrs.uid as string
    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenNthCalledWith(1, {
      id: 'c-1',
      nodes: [
        { id: 'p1', from: 0, to: 5 },
        { id: copyUid, from: 0, to: 5 },
      ],
      quote: 'hellohello',
    })

    // Undo removes the copy (paste + re-mint are one history event): the
    // extended segment goes dormant — no ghost highlight — and the follow-up
    // report drops it from the row (live-only writes).
    created.editor.commands.undo()
    expect(spanTexts(created.editor)).toEqual(['hello'])

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(2)
    expect(sink).toHaveBeenNthCalledWith(2, {
      id: 'c-1',
      nodes: [{ id: 'p1', from: 0, to: 5 }],
      quote: 'hello',
    })

    // Redo restores the copy: the in-session dormant seed revives it and the
    // next report re-extends the row.
    created.editor.commands.redo()
    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])
    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenNthCalledWith(3, {
      id: 'c-1',
      nodes: [
        { id: 'p1', from: 0, to: 5 },
        { id: copyUid, from: 0, to: 5 },
      ],
      quote: 'hellohello',
    })
  })
})

describe('copy-extend through the REAL pipeline — remap half and the drop arm', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('REAL pipeline — a CLOSED block paste materializes, collides and extends (remap half)', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // data-pm-slice="0 0" = a CLOSED slice: the block materializes as its own
    // node instead of merging — the collision/remap path, driven through the
    // same clipboard machinery a browser paste uses.
    created.editor.commands.setTextSelection(12)
    const pasteEvent = new Event('paste') as ClipboardEvent // jsdom has no ClipboardEvent
    created.editor.view.pasteHTML(
      '<p data-pm-slice="0 0 []" data-uid="p1">hello world</p>',
      pasteEvent,
    )

    const copyUid = created.editor.state.doc.child(1).attrs.uid as string
    expect(copyUid).not.toBe('p1')
    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      nodes: [
        { id: 'p1', from: 0, to: 5 },
        { id: copyUid, from: 0, to: 5 },
      ],
      quote: 'hellohello',
    })
  })

  it('drop arm — an alt-drag COPY (source survives) extends onto the target block', () => {
    // The full drop EVENT plumbing needs layout jsdom does not have; this
    // drives the plugin contract directly — the latch primes through the REAL
    // transformPasted prop chain, and the landing transaction carries the
    // uiEvent meta prosemirror-view stamps on drops.
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    let slice = parseSliceFromHTML(created.editor, '<p data-uid="p1">llo wo</p>')
    created.editor.view.someProp('transformPasted', (fn) => {
      slice = fn(slice, created.editor.view, false)
    })
    created.editor.view.dispatch(
      created.editor.state.tr.replaceRange(22, 22, slice).setMeta('uiEvent', 'drop'),
    )

    // 'llo wo' aligns at 2, ∩ [0, 5) = 'llo' → target-local [8, 11) on p2.
    expect(spanTexts(created.editor)).toEqual(['hello', 'llo'])
  })

  it('drop arm — a drag MOVE (delete + insert, one transaction) extends nothing', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    let slice = parseSliceFromHTML(created.editor, '<p data-uid="p1">hello</p>')
    created.editor.view.someProp('transformPasted', (fn) => {
      slice = fn(slice, created.editor.view, false)
    })
    // The move shape: the same transaction deletes the dragged text and
    // inserts it at the target — the delete collapses the live segment BEFORE
    // the merge half runs, so only LIVE segments extend (anti-ghost).
    const tr = created.editor.state.tr.delete(1, 6)
    tr.replaceRange(tr.mapping.map(22), tr.mapping.map(22), slice)
    created.editor.view.dispatch(tr.setMeta('uiEvent', 'drop'))

    expect(spanTexts(created.editor)).toEqual([])
  })
})
