import { describe, expect, it } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import { parseSliceFromHTML, renderEditor } from '../../test/editorHarness'
import { HeadingFeature } from '../blocks/heading'
import { ListsFeature } from '../blocks/lists'
import { HistoryFeature } from '../history'
import { VariableFeature } from './variable'
// Deliberate deep import: the remap meta stays SDK-internal, and this suite is
// exactly the consumer contract it exists for.
import { UID_REMAPPED_META, type UidRemapMeta } from '../../editor/core/nodeIdsExtension'
import { textForSegments } from './commentAnchor'
import {
  CommentsFeature,
  getCommentAnchorState,
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

/** The envelope's anchor half, as the provider's bridge reads it: the CURRENT
 *  canonical payload of every drifted comment. Pull-based and non-clearing —
 *  collecting twice yields the same reports. Per-segment quotes are STRIPPED:
 *  these are geometry assertions (id/from/to + the whole-anchor quote); the
 *  per-segment quote contract has its own raw pins. */
const collectAnchors = (editor: Editor) =>
  getCommentsStorage(editor)!.collectDirtyAnchors!().map((report) => ({
    ...report,
    nodes: report.nodes.map(({ id, from, to }) => ({ id, from, to })),
  }))

/** The envelope carrying what a collect just returned was persisted: those
 *  payloads become the baselines (the stored row, from here on). */
const confirmAnchors = (editor: Editor) =>
  getCommentsStorage(editor)!.confirmAnchorsSaved!(collectAnchors(editor))

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

describe('copy-extend (plan §6, decision 5 — the comment follows the copy)', () => {
  it('full-block copy: the comment gains a segment on the copy with IDENTICAL offsets', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
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

    expect(collectAnchors(created.editor)).toEqual([
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: copyUid, from: 0, to: 5 },
        ],
        quote: 'hellohello',
      },
    ])
  })

  it('partial copy: the copy gets exactly the INTERSECTION, shifted to its own frame', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // A partial copy's slice keeps the block attrs — the pasted node carries
    // the source uid over a SUBSTRING ('lo world' aligns at source offset 3),
    // overlapping the commented [0, 5) only on [3, 5).
    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size,
      paragraph('p1', 'lo world'),
    )
    const copyUid = created.editor.state.doc.child(1).attrs.uid as string

    expect(collectAnchors(created.editor)).toEqual([
      {
        id: 'c-1',
        // [3, 5) in the source frame → [0, 2) in the copy's: 'lo'.
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: copyUid, from: 0, to: 2 },
        ],
        quote: 'hellolo',
      },
    ])
  })

  it('no-overlap copy: the remap fires but the comment stays put — no extend, no report', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
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
    // The ledger stayed clean: nothing to carry in the next envelope.
    expect(collectAnchors(created.editor)).toEqual([])
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

    // Intersection [3, 6) in the source frame → [0, 3) on the copy: chip,
    // ' ', 'c'.
    const expectedNodes = [
      { id: 'p1', from: 1, to: 6 },
      { id: copyUid, from: 0, to: 3 },
    ]
    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-1', nodes: expectedNodes, quote: 'b  c c' },
    ])
    // Golden-vector style: re-reading the reported segments off the doc
    // reproduces the quote — offsets and atom widths agree end to end.
    expect(textForSegments(created.editor.state.doc, expectedNodes)).toBe('b  c c')
  })

  it('split does NOT double-extend: the recorded remap misses alignment, live mapping wins', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'helloworld')),
    })
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

    // Exactly the plain split expectation (commentReporter.test.ts): two
    // segments from live mapping — a double-extend would smuggle a third.
    expect(collectAnchors(created.editor)).toEqual([
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: secondUid, from: 0, to: 5 },
        ],
        quote: 'helloworld',
      },
    ])
  })

  it('double paste extends twice: three segments, unique uids, ONE coalesced report', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    const clipboard = paragraph('p1', 'hello world')
    created.editor.commands.insertContentAt(created.editor.state.doc.content.size, clipboard)
    created.editor.commands.insertContentAt(created.editor.state.doc.content.size, clipboard)
    const firstUid = created.editor.state.doc.child(1).attrs.uid as string
    const secondUid = created.editor.state.doc.child(2).attrs.uid as string
    expect(new Set(['p1', firstUid, secondUid]).size).toBe(3)

    // Both pastes ride the SAME envelope — one report per comment, carrying
    // the full three-segment anchor in document order.
    expect(collectAnchors(created.editor)).toEqual([
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: firstUid, from: 0, to: 5 },
          { id: secondUid, from: 0, to: 5 },
        ],
        quote: 'hellohellohello',
      },
    ])
  })

  it('REAL pipeline — pasted text that MERGES into another block extends onto the TARGET node', () => {
    // The dominant gesture: select text, ⌘C, ⌘V at a caret. The clipboard is
    // an OPEN slice (data-pm-slice) that merges into the target block — no
    // node is born, no uid collides, so this exercises the merge half of
    // copy-extend, not the remap half.
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
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

    expect(collectAnchors(created.editor)).toEqual([
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p2', from: 8, to: 11 },
        ],
        quote: 'hellollo',
      },
    ])
  })

  it('REAL pipeline — pasting the same clipboard twice accumulates one segment per paste', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    const pasteEvent = new Event('paste') as ClipboardEvent
    const clipboard = '<p data-pm-slice="1 1 []" data-uid="p1">llo wo</p>'
    created.editor.commands.setTextSelection(22)
    created.editor.view.pasteHTML(clipboard, pasteEvent)
    // The caret lands after the pasted text — the second paste is contiguous.
    created.editor.view.pasteHTML(clipboard, pasteEvent)

    expect(spanTexts(created.editor)).toEqual(['hello', 'llo', 'llo'])

    expect(collectAnchors(created.editor)).toEqual([
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p2', from: 8, to: 11 },
          { id: 'p2', from: 14, to: 17 },
        ],
        quote: 'hellollollo',
      },
    ])
  })

  it('REAL pipeline — pasted text with no commented overlap extends nothing', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.commands.setTextSelection(22)
    const pasteEvent = new Event('paste') as ClipboardEvent
    // ' world' aligns at source offset 5 — entirely outside the commented [0, 5).
    created.editor.view.pasteHTML('<p data-pm-slice="1 1 []" data-uid="p1"> world</p>', pasteEvent)

    expect(spanTexts(created.editor)).toEqual(['hello'])
    expect(collectAnchors(created.editor)).toEqual([])
  })

  it('REAL pipeline — a merged paste never revives DELETED text (anti-ghost holds)', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // DELETE the commented text (no cut, so no clipboard carry): the live
    // range collapses and the comment orphans …
    created.editor.commands.deleteRange({ from: 1, to: 6 })
    expect(spanTexts(created.editor)).toEqual([])

    // … so pasting the same characters INTO another block extends nothing:
    // only LIVE segments feed the copy halves. (A real CUT does carry — see
    // the cut-carry suite below.)
    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    const pasteEvent = new Event('paste') as ClipboardEvent
    created.editor.view.pasteHTML('<p data-pm-slice="1 1 []" data-uid="p1">hello</p>', pasteEvent)
    expect(spanTexts(created.editor)).toEqual([])
  })

  it('undo after the envelope landed sheds the copy segment from the ROW — redo re-extends live', () => {
    // Plan §6 (assumed consequences) and §10.3, under the live-only write
    // rule: undo of the paste AFTER the envelope confirmed leaves the copy
    // segment dormant IN SESSION (plugin state, redo revives it), while the
    // follow-up envelope self-cleans the row back to the live segment only.
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size,
      paragraph('p1', 'hello world'),
    )
    const copyUid = created.editor.state.doc.child(1).attrs.uid as string
    const extended = [
      { id: 'p1', from: 0, to: 5 },
      { id: copyUid, from: 0, to: 5 },
    ]
    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-1', nodes: extended, quote: 'hellohello' },
    ])
    // The envelope carrying it landed: the two-segment anchor IS the row now.
    confirmAnchors(created.editor)

    // Undo removes the copy (paste + re-mint are one history event): the
    // extended segment goes dormant — no ghost highlight — and the next
    // envelope drops it from the row (live-only writes).
    created.editor.commands.undo()
    expect(spanTexts(created.editor)).toEqual(['hello'])

    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }], quote: 'hello' },
    ])
    confirmAnchors(created.editor)

    // Redo restores the copy: the in-session dormant seed revives it and the
    // next envelope re-extends the row.
    created.editor.commands.redo()
    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])
    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-1', nodes: extended, quote: 'hellohello' },
    ])
  })
})

describe('copy-extend through the REAL pipeline — remap half and the drop arm', () => {
  it('REAL pipeline — a CLOSED block paste materializes, collides and extends (remap half)', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
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

    expect(collectAnchors(created.editor)).toEqual([
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: copyUid, from: 0, to: 5 },
        ],
        quote: 'hellohello',
      },
    ])
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

  it('drop arm — a drag MOVE carries the comment to the drop point (drag = move, like cut+paste)', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    let slice = parseSliceFromHTML(created.editor, '<p data-uid="p1">hello</p>')
    created.editor.view.someProp('transformPasted', (fn) => {
      slice = fn(slice, created.editor.view, false)
    })
    // The move shape, faithfully: a real drag starts from the SELECTED text
    // (dragstart reads view.state.selection), then ONE transaction deletes
    // that range and inserts the slice at the drop point under 'drop'. The
    // deleted-old-selection pair is what tells a move apart from an external
    // drop or an alt-drag copy — and it is what arms the inline carry.
    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    const tr = created.editor.state.tr.delete(1, 6)
    tr.replaceRange(tr.mapping.map(22), tr.mapping.map(22), slice)
    created.editor.view.dispatch(tr.setMeta('uiEvent', 'drop'))

    expect(spanTexts(created.editor)).toEqual(['hello'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p2', from: 8, to: 13 }], quote: 'hello' },
    ])
  })

  it('drop arm — dragging a SUBRANGE out keeps both halves highlighted', () => {
    // The half-a-comment drag: 'world' leaves, 'hello ' stays. The carry must
    // fire off the deleted-selection guard, never off "the comment fully
    // collapsed" — a subrange move collapses nothing, and gating on collapse
    // would silently lose exactly the half that travelled.
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 11 }] }])

    let slice = parseSliceFromHTML(created.editor, '<p data-uid="p1">world</p>')
    created.editor.view.someProp('transformPasted', (fn) => {
      slice = fn(slice, created.editor.view, false)
    })
    created.editor.commands.setTextSelection({ from: 7, to: 12 })
    const tr = created.editor.state.tr.delete(7, 12)
    tr.replaceRange(tr.mapping.map(22), tr.mapping.map(22), slice)
    created.editor.view.dispatch(tr.setMeta('uiEvent', 'drop'))

    expect(spanTexts(created.editor)).toEqual(['hello ', 'world'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
  })

  it('drop arm — an EXTERNAL drop (nothing deleted) never arms the carry', () => {
    // The stale-selection case the guard exists for: the user has commented
    // text SELECTED, and content from outside the editor is dropped at the
    // end. Nothing is deleted, so this is no move — arming the carry off the
    // mere selection would text-match the dropped copy and duplicate the
    // highlight onto content nobody moved.
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])
    created.editor.commands.setTextSelection({ from: 1, to: 6 })

    let slice = parseSliceFromHTML(created.editor, '<p data-uid="ext">hello</p>')
    created.editor.view.someProp('transformPasted', (fn) => {
      slice = fn(slice, created.editor.view, false)
    })
    const end = created.editor.state.doc.content.size - 1
    created.editor.view.dispatch(
      created.editor.state.tr.replaceRange(end, end, slice).setMeta('uiEvent', 'drop'),
    )

    // Only the original highlight — the dropped copy gained nothing.
    expect(spanTexts(created.editor)).toEqual(['hello'])
  })
})

/* CUT-CARRY (plan §6, decision 5 — "cut = move" for TEXT). Cutting a whole
 * BLOCK is already free: its uid leaves the doc and reappears on paste, and
 * the revival trigger restores the highlight. Cutting TEXT leaves the node
 * behind, so nothing moves and the range simply dies — these pin that the
 * cut buffer brings the comment along, and that it never fires on text that
 * was not the one cut. */
describe('cut-carry — the comment follows a cut of TEXT', () => {
  /** What a browser cut dispatches: PM stamps `uiEvent: 'cut'` on the
   *  deletion of the current selection. */
  const cut = (editor: Editor, from: number, to: number) => {
    editor.commands.setTextSelection({ from, to })
    editor.view.dispatch(editor.state.tr.deleteSelection().setMeta('uiEvent', 'cut'))
  }
  const pasteAt = (editor: Editor, pos: number, html: string) => {
    editor.commands.setTextSelection(pos)
    editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent)
  }

  it('cut + paste elsewhere: the highlight lands on the pasted text', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])
    expect(spanTexts(created.editor)).toEqual(['hello'])

    // Cut 'hello' — the node survives, so the range dies and the card orphans.
    cut(created.editor, 1, 6)
    expect(spanTexts(created.editor)).toEqual([])

    // Paste it into the other paragraph: the cut buffer re-anchors it there.
    pasteAt(created.editor, created.editor.state.doc.content.size - 1, '<p data-pm-slice="1 1 []">hello</p>')
    expect(spanTexts(created.editor)).toEqual(['hello'])
    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p2', from: 8, to: 13 }], quote: 'hello' },
    ])
  })

  it('cut of a WIDER selection carries only the commented part', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Cut 'hello world' — the comment covers only its first five characters.
    cut(created.editor, 1, 12)
    pasteAt(
      created.editor,
      created.editor.state.doc.content.size - 1,
      '<p data-pm-slice="1 1 []">hello world</p>',
    )

    expect(spanTexts(created.editor)).toEqual(['hello'])
    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p2', from: 8, to: 13 }], quote: 'hello' },
    ])
  })

  it('pasting the cut TWICE carries to both places — the second is a duplication', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'a: '), paragraph('p3', 'b: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    cut(created.editor, 1, 6)
    const clipboard = '<p data-pm-slice="1 1 []">hello</p>'
    // p2 content starts at 9 (p1 'world' is 7 wide), p3 after it.
    pasteAt(created.editor, 11, clipboard)
    pasteAt(created.editor, created.editor.state.doc.content.size - 1, clipboard)

    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])
    expect(collectAnchors(created.editor)[0]!.nodes).toHaveLength(2)
  })

  it('a cut with NOTHING pasted orphans — unrelated text never revives it, and the DETACH ships', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    cut(created.editor, 1, 6)
    // Typing where it used to be must NOT re-light it (the anti-ghost rule)…
    created.editor.commands.insertContentAt(1, 'adieu')
    expect(spanTexts(created.editor)).toEqual([])

    // …and neither does pasting DIFFERENT text: the buffer is matched by the
    // very characters that were cut.
    pasteAt(
      created.editor,
      created.editor.state.doc.content.size - 1,
      '<p data-pm-slice="1 1 []">something else</p>',
    )
    expect(spanTexts(created.editor)).toEqual([])
    // The envelope carries the PROVEN detach — the stored row must not keep
    // describing text this document no longer holds. (A later in-session
    // paste of the real characters still resurrects the tombstone and the
    // next envelope restores the row.)
    expect(collectAnchors(created.editor)).toEqual([{ id: 'c-1', nodes: [], quote: '' }])
  })

  it('a plain DELETE (no cut) never carries — only a real cut records a buffer', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Deleted, not cut: nothing was taken to the clipboard, so a later paste
    // of the same characters is unrelated content.
    created.editor.commands.deleteRange({ from: 1, to: 6 })
    pasteAt(created.editor, created.editor.state.doc.content.size - 1, '<p data-pm-slice="1 1 []">hello</p>')
    expect(spanTexts(created.editor)).toEqual([])
  })

  it('the carry survives the detach round-trip: save, records refresh, THEN paste still revives', () => {
    // The regression the bridge's keep-empty-rows rule exists for. The save
    // debounce routinely lands between a cut and its paste: the DETACH write
    // round-trips, the backend row comes back as `nodes: []`, and the
    // records refresh re-lands the population. The row STAYING in storage is
    // what keeps the tombstone (the membership reconcile evicts ids that
    // left), so the paste can still resurrect — and the next envelope heals
    // the row.
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    cut(created.editor, 1, 6)
    expect(collectAnchors(created.editor)).toEqual([{ id: 'c-1', nodes: [], quote: '' }])
    confirmAnchors(created.editor)

    // The refresh: the provider re-lands what the backend now holds.
    seedComments(created.editor, [{ id: 'c-1', nodes: [] }])

    pasteAt(created.editor, created.editor.state.doc.content.size - 1, '<p data-pm-slice="1 1 []">hello</p>')
    expect(spanTexts(created.editor)).toEqual(['hello'])
    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p2', from: 8, to: 13 }], quote: 'hello' },
    ])
  })

  it('undo after the detach round-trip still restores the highlight — and the next envelope heals the row', () => {
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    cut(created.editor, 1, 6)
    confirmAnchors(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [] }])

    created.editor.commands.undo()

    expect(spanTexts(created.editor)).toEqual(['hello'])
    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }], quote: 'hello' },
    ])
  })

  it('a FRESH session seeded with the detached row stays orphaned — paste-back revival is session-scoped', () => {
    // The accepted limit (orphan-forever, the delete rule): the collapse
    // snapshots and the carry buffer are plugin state, so a comment whose
    // detach was persisted has nothing to revive from in a new session —
    // pasting the very characters back re-lights nothing and, crucially,
    // ships no write (an empty row has no death to prove).
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', ' world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [] }])

    pasteAt(created.editor, created.editor.state.doc.content.size - 1, '<p data-pm-slice="1 1 []">hello</p>')

    expect(spanTexts(created.editor)).toEqual([])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')
    expect(collectAnchors(created.editor)).toEqual([])
  })
})

/* The undo path of a cut-carry: reverting cut+paste must put the comment
 * back on the ORIGINAL text. The carry keeps the killed entries as undo
 * seeds (flagged, so they never read as "partially detached"); dropping them
 * — as the first implementation did — silently lost the anchor. */
describe('cut-carry — undo restores the original anchor', () => {
  it('cut → paste → undo everything: the comment is back on the original text', () => {
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])
    const before = created.editor.getJSON()
    expect(spanTexts(created.editor)).toEqual(['hello'])

    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    created.editor.view.dispatch(
      created.editor.state.tr.deleteSelection().setMeta('uiEvent', 'cut'),
    )
    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    created.editor.view.pasteHTML(
      '<p data-pm-slice="1 1 []">hello</p>',
      new Event('paste') as ClipboardEvent,
    )
    expect(spanTexts(created.editor)).toEqual(['hello'])
    // The carry is NOT a detachment: the text moved, nothing was lost.
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')

    // Undo everything back to the starting document.
    while (created.editor.can().undo() && JSON.stringify(created.editor.getJSON()) !== JSON.stringify(before)) {
      created.editor.commands.undo()
    }
    expect(created.editor.getJSON()).toEqual(before)

    expect(spanTexts(created.editor)).toEqual(['hello'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(collectAnchors(created.editor)).toEqual([])
  })

  it('a carried comment reads as ANCHORED, never "partially detached"', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    created.editor.view.dispatch(
      created.editor.state.tr.deleteSelection().setMeta('uiEvent', 'cut'),
    )
    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    created.editor.view.pasteHTML(
      '<p data-pm-slice="1 1 []">hello</p>',
      new Event('paste') as ClipboardEvent,
    )

    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    // And the write carries ONE segment — the undo seed never travels.
    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p2', from: 8, to: 13 }], quote: 'hello' },
    ])
  })
})

/* MULTI-BLOCK copies. The closed blocks in the middle materialize (remap
 * half), but the slice's OPEN EDGES merge into existing blocks — the first
 * child into the block holding the caret, the last into the block the tail
 * ended up in. Those edges used to fall between the halves: copying two
 * paragraphs and pasting them left the copy with no highlight at all. */
describe('copy-extend across a multi-block copy', () => {
  const pasteAt = (editor: Editor, pos: number, html: string) => {
    editor.commands.setTextSelection(pos)
    editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent)
  }

  it('OPEN slice: the comment in the first paragraph follows the merged edge', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(
        paragraph('p1', 'hello world'),
        paragraph('p2', 'second'),
        paragraph('p3', 'target: '),
      ),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Selecting from INSIDE the first paragraph to INSIDE the second gives an
    // open slice: the first block merges at the caret, the second materializes.
    pasteAt(
      created.editor,
      created.editor.state.doc.content.size - 1,
      '<p data-pm-slice="1 1 []" data-uid="p1">hello world</p><p data-uid="p2">second</p>',
    )

    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])
    expect(collectAnchors(created.editor)).toEqual([
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p3', from: 8, to: 13 },
        ],
        quote: 'hellohello',
      },
    ])
  })

  it('OPEN slice: a comment in the LAST copied paragraph follows the tail edge', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(
        paragraph('p1', 'first'),
        paragraph('p2', 'hello world'),
        paragraph('p3', 'target: '),
      ),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p2', from: 0, to: 5 }] }])

    // Pasting INTO the middle of the target splits it, so the slice's last
    // child merges with the tail — the other open edge.
    pasteAt(
      created.editor,
      created.editor.state.doc.content.size - 3,
      '<p data-pm-slice="1 1 []" data-uid="p1">first</p><p data-uid="p2">hello world</p>',
    )

    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])
    expect(collectAnchors(created.editor)[0]!.nodes).toHaveLength(2)
  })

  it('CLOSED slice: both blocks materialize and the remap half still extends', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(
        paragraph('p1', 'hello world'),
        paragraph('p2', 'second'),
        paragraph('p3', 'target: '),
      ),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    pasteAt(
      created.editor,
      created.editor.state.doc.content.size - 1,
      '<p data-pm-slice="0 0 []" data-uid="p1">hello world</p><p data-uid="p2">second</p>',
    )

    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])
    // The copy landed on its OWN fresh uid, not on the target block.
    const copyUid = created.editor.state.doc.child(3).attrs.uid as string
    expect(copyUid).not.toBe('p1')
    expect(collectAnchors(created.editor)).toEqual([
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: copyUid, from: 0, to: 5 },
        ],
        quote: 'hellohello',
      },
    ])
  })

  it('a multi-block copy with NO comment in it extends nothing', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(
        paragraph('p1', 'hello world'),
        paragraph('p2', 'second'),
        paragraph('p3', 'target: '),
      ),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])

    // 'world' is commented; the copied window covers only 'hello' and 'second'.
    pasteAt(
      created.editor,
      created.editor.state.doc.content.size - 1,
      '<p data-pm-slice="1 1 []" data-uid="p1">hello</p><p data-uid="p2">second</p>',
    )

    expect(spanTexts(created.editor)).toEqual(['world'])
    expect(collectAnchors(created.editor)).toEqual([])
  })
})

/* Cutting TWO WHOLE paragraphs and pasting them elsewhere. The trap: the cut
 * merges the two partially-selected blocks and leaves an EMPTY SHELL still
 * holding the first block's uid, so the uid never leaves the document — the
 * pasted copy collides and is re-minted instead of "reappearing", and the
 * plain revival trigger cannot fire. */
describe('cut-carry across MULTIPLE blocks', () => {
  const twoParagraphDoc = () =>
    docOf(
      paragraph('p1', 'deadline is 30 days'),
      paragraph('p2', 'payment terms'),
      paragraph('p3', 'liability is capped'),
    )
  /** '30 days' inside the first paragraph (local offsets 12..19). */
  const DEADLINE = { id: 'c-1', nodes: [{ id: 'p1', from: 12, to: 19 }] }
  const cutBoth = (editor: Editor) => {
    editor.commands.setTextSelection({ from: 1, to: 35 })
    editor.view.dispatch(editor.state.tr.deleteSelection().setMeta('uiEvent', 'cut'))
  }
  const clipboard = (slice: string) =>
    `<p data-pm-slice="${slice}" data-uid="p1">deadline is 30 days</p><p data-uid="p2">payment terms</p>`

  it('CLOSED slice: the pasted copy is re-minted and the comment follows it', () => {
    const created = renderEditor([CommentsFeature], { content: twoParagraphDoc() })
    seedComments(created.editor, [DEADLINE])
    expect(spanTexts(created.editor)).toEqual(['30 days'])

    cutBoth(created.editor)
    expect(spanTexts(created.editor)).toEqual([])

    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    created.editor.view.pasteHTML(clipboard('0 0 []'), new Event('paste') as ClipboardEvent)

    expect(spanTexts(created.editor)).toEqual(['30 days'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    // The anchor points at the copy's FRESH uid — not the empty shell that
    // kept the original one.
    const [report] = collectAnchors(created.editor)
    expect(report!.quote).toBe('30 days')
    expect(report!.nodes[0]!.id).not.toBe('p1')
  })

  it('OPEN slice: the merged edge carries it too', () => {
    const created = renderEditor([CommentsFeature], { content: twoParagraphDoc() })
    seedComments(created.editor, [DEADLINE])

    cutBoth(created.editor)
    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    created.editor.view.pasteHTML(clipboard('1 1 []'), new Event('paste') as ClipboardEvent)

    expect(spanTexts(created.editor)).toEqual(['30 days'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(collectAnchors(created.editor)[0]!.quote).toBe('30 days')
  })

  it('pasting DIFFERENT text after the same cut revives nothing', () => {
    const created = renderEditor([CommentsFeature], { content: twoParagraphDoc() })
    seedComments(created.editor, [DEADLINE])

    cutBoth(created.editor)
    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    created.editor.view.pasteHTML(
      '<p data-pm-slice="0 0 []" data-uid="other">unrelated content</p>',
      new Event('paste') as ClipboardEvent,
    )

    expect(spanTexts(created.editor)).toEqual([])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')
  })

  it('a MULTI-BLOCK cut carries a comment from the SECOND paragraph as well', () => {
    const created = renderEditor([CommentsFeature], { content: twoParagraphDoc() })
    // 'terms' inside the second paragraph (local offsets 8..13).
    seedComments(created.editor, [{ id: 'c-2', nodes: [{ id: 'p2', from: 8, to: 13 }] }])
    expect(spanTexts(created.editor)).toEqual(['terms'])

    cutBoth(created.editor)
    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    created.editor.view.pasteHTML(clipboard('0 0 []'), new Event('paste') as ClipboardEvent)

    expect(spanTexts(created.editor)).toEqual(['terms'])
    expect(getCommentAnchorState(created.editor, 'c-2')).toBe('anchored')
  })

  it('THREE blocks, BOTH edges partial — the full anchor relocates (the reported gesture)', () => {
    // The field report: a comment spanning three paragraphs, cut from
    // mid-first to mid-third (all of the middle), pasted elsewhere — every
    // paragraph must arrive highlighted: the head onto the block the open
    // edge merged into, the middle onto its preserved uid, the tail onto the
    // block the paste materialized.
    const created = renderEditor([CommentsFeature], { content: twoParagraphDoc() })
    seedComments(created.editor, [
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 12, to: 19 },
          { id: 'p2', from: 0, to: 13 },
          { id: 'p3', from: 0, to: 9 },
        ],
      },
    ])
    expect(spanTexts(created.editor)).toEqual(['30 days', 'payment terms', 'liability'])

    // Cut 'is 30 days' + all of p2 + 'liability' — the merge leaves ONE
    // surviving block (uid p1): 'deadline  is capped'.
    created.editor.commands.setTextSelection({ from: 10, to: 46 })
    created.editor.view.dispatch(created.editor.state.tr.deleteSelection().setMeta('uiEvent', 'cut'))
    expect(spanTexts(created.editor)).toEqual([])

    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    created.editor.view.pasteHTML(
      '<p data-pm-slice="1 1 []" data-uid="p1">is 30 days</p>' +
        '<p data-uid="p2">payment terms</p>' +
        '<p data-uid="p3">liability</p>',
      new Event('paste') as ClipboardEvent,
    )

    expect(spanTexts(created.editor)).toEqual(['30 days', 'payment terms', 'liability'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    const [report] = collectAnchors(created.editor)
    expect(report!.nodes).toHaveLength(3)
    expect(report!.quote).toBe('30 dayspayment termsliability')
  })

  it('the duplicate-uid window: the carry binds the PASTED copy, never the surviving remainder', () => {
    // Defect-B pin. The cut leaves a NON-empty survivor still holding p1;
    // the closed slice materializes a copy that transiently holds p1 too.
    // An identity round-trip through the uid index resolves to the FIRST
    // holder — the survivor — and paints a ghost there ('line ', clamped
    // into 'deadline '). The carry must bind the node it text-matched, and a
    // duplicated uid defers one apply until the kernel re-mints the copy.
    const created = renderEditor([CommentsFeature], { content: twoParagraphDoc() })
    seedComments(created.editor, [DEADLINE])
    expect(spanTexts(created.editor)).toEqual(['30 days'])

    // Cut 'is 30 days' + all of p2: the survivor keeps 'deadline ' under p1.
    created.editor.commands.setTextSelection({ from: 10, to: 35 })
    created.editor.view.dispatch(created.editor.state.tr.deleteSelection().setMeta('uiEvent', 'cut'))
    expect(spanTexts(created.editor)).toEqual([])

    // Paste BELOW the survivor as a CLOSED slice still carrying p1 — the
    // first-occurrence lookup would land on the survivor above.
    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    created.editor.view.pasteHTML(
      '<p data-pm-slice="0 0 []" data-uid="p1">is 30 days</p>',
      new Event('paste') as ClipboardEvent,
    )

    // Exactly ONE highlight, on the pasted copy — no ghost in the survivor.
    expect(spanTexts(created.editor)).toEqual(['30 days'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    const [report] = collectAnchors(created.editor)
    expect(report!.nodes).toHaveLength(1)
    expect(report!.nodes[0]!.id).not.toBe('p1')
    expect(report!.quote).toBe('30 days')
  })
})

/* A cut that runs THROUGH a commented range — from a heading down to the
 * middle of "30 days" — splits the comment across the document: what stayed
 * keeps its highlight, and what travelled must arrive with its own. The
 * pasted block is born in the paste dispatch and only gets its uid from the
 * kernel afterwards, so the carry has to survive a few applies to land. */
describe('cut-carry through the MIDDLE of a comment', () => {
  const contractDoc = () =>
    docOf(
      { type: 'heading', attrs: { uid: 'h1', level: 1 }, content: [{ type: 'text', text: 'Review me' }] },
      paragraph('p1', 'The delivery deadline is 30 days after signature.'),
      paragraph('p2', 'Payment terms follow.'),
    )
  /** '30 days' inside the first paragraph (local offsets 25..32). */
  const DEADLINE = { id: 'c-1', nodes: [{ id: 'p1', from: 25, to: 32 }] }
  /** Heading start through '…is 30' — the selection stops mid-comment. */
  const cutThrough = (editor: Editor) => {
    editor.commands.setTextSelection({ from: 1, to: 39 })
    editor.view.dispatch(editor.state.tr.deleteSelection().setMeta('uiEvent', 'cut'))
  }

  it('the part that stayed keeps its highlight and the part that moved gets one', () => {
    const created = renderEditor([HeadingFeature, CommentsFeature], { content: contractDoc() })
    seedComments(created.editor, [DEADLINE])
    expect(spanTexts(created.editor)).toEqual(['30 days'])

    cutThrough(created.editor)
    // Only ' days' survived in place.
    expect(spanTexts(created.editor)).toEqual([' days'])

    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    created.editor.view.pasteHTML(
      '<h1 data-pm-slice="1 1 []" data-uid="h1">Review me</h1>' +
        '<p data-uid="p1">The delivery deadline is 30</p>',
      new Event('paste') as ClipboardEvent,
    )

    // Both halves of the original comment are anchored again.
    expect(spanTexts(created.editor)).toEqual([' days', '30'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    const [report] = collectAnchors(created.editor)
    expect(report!.nodes).toHaveLength(2)
    expect(report!.quote).toBe(' days30')
  })

  it('the carry does not fire twice for the same paste', () => {
    const created = renderEditor([HeadingFeature, CommentsFeature], { content: contractDoc() })
    seedComments(created.editor, [DEADLINE])
    cutThrough(created.editor)

    created.editor.commands.setTextSelection(created.editor.state.doc.content.size - 1)
    created.editor.view.pasteHTML(
      '<p data-pm-slice="1 1 []" data-uid="p1">The delivery deadline is 30</p>',
      new Event('paste') as ClipboardEvent,
    )

    // The retry window re-attempts the carry while the kernel stamps uids —
    // an already-anchored range must never be added a second time.
    expect(spanTexts(created.editor)).toEqual([' days', '30'])
    expect(collectAnchors(created.editor)[0]!.nodes).toHaveLength(2)
  })

  it('typing the same characters later never re-anchors — the window has closed', () => {
    const created = renderEditor([HeadingFeature, CommentsFeature], { content: contractDoc() })
    seedComments(created.editor, [DEADLINE])
    cutThrough(created.editor)

    // No paste: the user types the cut text by hand, a few edits apart.
    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size - 1,
      'The delivery deadline is 30',
    )
    created.editor.commands.insertContentAt(1, 'x')

    expect(spanTexts(created.editor)).toEqual([' days'])
  })
})

/* The rest of the matrix: shapes the four halves must handle even though no
 * bug report has hit them yet. Each is a real gesture — two comments in one
 * copy, nested blocks, the empty-line paste, pasting over a selection,
 * pasting into the source itself, a multi-segment source, a chip inside a
 * merged paste. */
describe('copy/cut matrix — the remaining gestures', () => {
  const pasteAt = (editor: Editor, pos: number, html: string) => {
    editor.commands.setTextSelection(pos)
    editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent)
  }
  const cutRange = (editor: Editor, from: number, to: number) => {
    editor.commands.setTextSelection({ from, to })
    editor.view.dispatch(editor.state.tr.deleteSelection().setMeta('uiEvent', 'cut'))
  }

  it('TWO comments inside one copied range both extend', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'alpha beta'), paragraph('p2', 'target: ')),
    })
    seedComments(created.editor, [
      { id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] },
      { id: 'c-2', nodes: [{ id: 'p1', from: 6, to: 10 }] },
    ])

    pasteAt(created.editor, created.editor.state.doc.content.size - 1, '<p data-pm-slice="1 1 []" data-uid="p1">alpha beta</p>')

    expect(spanTexts(created.editor)).toEqual(['alpha', 'beta', 'alpha', 'beta'])
    const reports = collectAnchors(created.editor)
    expect(reports.map((report) => report.id).sort()).toEqual(['c-1', 'c-2'])
    for (const report of reports) expect(report.nodes).toHaveLength(2)
  })

  it('a MULTI-SEGMENT comment copied whole extends every segment it covers', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'alpha beta'), paragraph('p2', 'target: ')),
    })
    // One comment, two segments in the same block.
    seedComments(created.editor, [
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p1', from: 6, to: 10 },
        ],
      },
    ])

    pasteAt(created.editor, created.editor.state.doc.content.size - 1, '<p data-pm-slice="1 1 []" data-uid="p1">alpha beta</p>')

    expect(spanTexts(created.editor)).toEqual(['alpha', 'beta', 'alpha', 'beta'])
    expect(collectAnchors(created.editor)[0]!.nodes).toHaveLength(4)
  })

  it('copy INSIDE A LIST: the item is a uid-carrying block like any other', () => {
    const created = renderEditor([ListsFeature, CommentsFeature], {
      content: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'bulletList',
              attrs: { uid: 'ul' },
              content: [
                {
                  type: 'listItem',
                  attrs: { uid: 'li' },
                  content: [paragraph('lp', 'hello world')],
                },
              ],
            },
            paragraph('p2', 'target: '),
          ],
        },
      },
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'lp', from: 0, to: 5 }] }])
    expect(spanTexts(created.editor)).toEqual(['hello'])

    // The clipboard of a copy out of a list arrives wrapped in its context —
    // the latch descends single-child wrappers to find the source block.
    pasteAt(
      created.editor,
      created.editor.state.doc.content.size - 1,
      '<ul data-pm-slice="3 3 []"><li><p data-uid="lp">hello world</p></li></ul>',
    )

    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])
  })

  it('paste into an EMPTY paragraph (the click-on-a-blank-line gesture)', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), { type: 'paragraph', attrs: { uid: 'p2' } }),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    pasteAt(created.editor, created.editor.state.doc.content.size - 1, '<p data-pm-slice="1 1 []" data-uid="p1">hello world</p>')

    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])
    expect(collectAnchors(created.editor)[0]!.nodes).toHaveLength(2)
  })

  it('paste OVER a selection: the replaced text loses its comment, the pasted one gains it', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'doomed text')),
    })
    seedComments(created.editor, [
      { id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] },
      { id: 'c-2', nodes: [{ id: 'p2', from: 0, to: 6 }] },
    ])
    expect(spanTexts(created.editor)).toEqual(['hello', 'doomed'])

    // Select 'doomed' in p2 and paste over it.
    created.editor.commands.setTextSelection({ from: 14, to: 20 })
    created.editor.view.pasteHTML(
      '<p data-pm-slice="1 1 []" data-uid="p1">hello world</p>',
      new Event('paste') as ClipboardEvent,
    )

    // c-2's text was REPLACED, so it orphans — a comment must never end up
    // covering the text that replaced the one it was made on.
    expect(getCommentAnchorState(created.editor, 'c-2')).toBe('orphaned')
    // c-1 followed the paste into the target block; c-2's death is proven
    // (its snapshot no longer resolves), so its DETACH ships alongside.
    // Ledger order is dirtying order: the wipe dirtied c-2 first.
    expect(spanTexts(created.editor)).toEqual(['hello', 'hello'])
    expect(collectAnchors(created.editor)).toEqual([
      { id: 'c-2', nodes: [], quote: '' },
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p2', from: 0, to: 5 },
        ],
        quote: 'hellohello',
      },
    ])
  })

  it('typing OVER a commented range orphans it too — same rule, no paste involved', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    created.editor.commands.insertContent('goodbye')

    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')
    expect(spanTexts(created.editor)).toEqual([])
  })

  it('editing INSIDE the range still keeps it — only a full wipe orphans', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Replace 'ell' inside 'hello' — part of the commented text survives.
    created.editor.commands.setTextSelection({ from: 2, to: 5 })
    created.editor.commands.insertContent('EY')

    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(spanTexts(created.editor)).toEqual(['hEYo'])
  })

  it('pasting back INTO the source block extends nothing — alignment cannot tell copy from original', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Caret at the end of the SAME paragraph the text came from.
    pasteAt(created.editor, 12, '<p data-pm-slice="1 1 []" data-uid="p1">hello</p>')

    expect(spanTexts(created.editor)).toEqual(['hello'])
    expect(collectAnchors(created.editor)).toEqual([])
  })

  it('a CHIP inside a MERGED paste keeps the atom-correct offsets', () => {
    const chip: JSONContent = {
      type: 'variable',
      attrs: { id: 'client.name', label: 'Client name', uid: 'chip-1' },
    }
    const created = renderEditor([VariableFeature, CommentsFeature], {
      content: docOf(
        {
          type: 'paragraph',
          attrs: { uid: 'p1' },
          content: [{ type: 'text', text: 'ab ' }, chip, { type: 'text', text: ' cd' }],
        },
        paragraph('p2', 'target: '),
      ),
    })
    // a(0) b(1) ' '(2) chip(3) ' '(4) c(5) d(6) — comment covers [1, 6).
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 1, to: 6 }] }])

    // Paste the chip-bearing tail into the other paragraph.
    pasteAt(
      created.editor,
      created.editor.state.doc.content.size - 1,
      '<p data-pm-slice="1 1 []" data-uid="p1">ab <span data-variable="client.name" data-label="Client name"></span> cd</p>',
    )

    const [report] = collectAnchors(created.editor)
    expect(report!.nodes).toHaveLength(2)
    // The copy's segment starts where 'b' sits in the pasted frame (offset 8:
    // 'target: ' is 8 characters) and spans the same 5 positions.
    expect(report!.nodes[1]).toEqual({ id: 'p2', from: 9, to: 14 })
  })

  it('CUT inside a list item and paste into a paragraph', () => {
    const created = renderEditor([ListsFeature, CommentsFeature], {
      content: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'bulletList',
              attrs: { uid: 'ul' },
              content: [
                { type: 'listItem', attrs: { uid: 'li' }, content: [paragraph('lp', 'hello world')] },
              ],
            },
            paragraph('p2', 'target: '),
          ],
        },
      },
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'lp', from: 0, to: 5 }] }])

    // 'hello' sits at abs [3, 8) inside the item's paragraph.
    cutRange(created.editor, 3, 8)
    expect(spanTexts(created.editor)).toEqual([])

    pasteAt(created.editor, created.editor.state.doc.content.size - 1, '<p data-pm-slice="1 1 []">hello</p>')
    expect(spanTexts(created.editor)).toEqual(['hello'])
  })
})
