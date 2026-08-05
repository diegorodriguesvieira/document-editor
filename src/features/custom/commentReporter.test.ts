import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import { renderEditor } from '../../test/editorHarness'
import { HeadingFeature } from '../blocks/heading'
import { HistoryFeature } from '../history'
import {
  ANCHOR_REPORT_DEBOUNCE_MS,
  CommentsFeature,
  getCommentPosition,
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

/** Well past one debounce window — "nothing else ever fires" assertions. */
const LONG_AFTER = ANCHOR_REPORT_DEBOUNCE_MS * 5

describe('anchor reporter (the segments plugin write side)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('typing before a highlight in its node reports ONCE after the window — trailing debounce', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])

    // Two edits inside one window: the second restarts the trailing timer.
    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 1))
    vi.advanceTimersByTime(400)
    created.editor.view.dispatch(created.editor.state.tr.insertText('Y', 2))

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS - 1)
    expect(sink).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(sink).toHaveBeenCalledTimes(1)
    // Node-local offsets re-derived from the LIVE range, quote from the doc.
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      nodes: [{ id: 'p1', from: 8, to: 13 }],
      quote: 'world',
    })

    // Quiescence after delivery: nothing else fires.
    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('editing other blocks never reports — even when the highlight only SHIFTED (offsets identical)', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p0', 'intro'), paragraph('p1', 'hello'), paragraph('p2', 'below')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Above the comment: absolute positions shift, node-local ones do not —
    // the recompute lands exactly on the last-reported baseline.
    created.editor.view.dispatch(created.editor.state.tr.insertText('XYZ', 1))
    // Below the comment: not even the absolute positions move.
    created.editor.view.dispatch(
      created.editor.state.tr.insertText('!', created.editor.state.doc.content.size - 1),
    )

    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).not.toHaveBeenCalled()
  })

  it('split reports 2 segments (both uids correct); the merge back reports 1', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'helloworld')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 10 }] }])

    // Split after 'hello' (abs 6): the second half re-mints (copy collision),
    // and the derivation must pick the FRESH uid up from the landed doc.
    created.editor.view.dispatch(created.editor.state.tr.split(6))
    const secondUid = created.editor.state.doc.child(1).attrs.uid as string
    expect(secondUid).not.toBe('p1')

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenLastCalledWith({
      id: 'c-1',
      nodes: [
        { id: 'p1', from: 0, to: 5 },
        { id: secondUid, from: 0, to: 5 },
      ],
      quote: 'helloworld',
    })

    // Join the blocks again (delete the close+open tokens): the live ranges
    // coalesce and the report collapses back to ONE segment.
    created.editor.view.dispatch(created.editor.state.tr.delete(6, 8))
    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(2)
    expect(sink).toHaveBeenLastCalledWith({
      id: 'c-1',
      nodes: [{ id: 'p1', from: 0, to: 10 }],
      quote: 'helloworld',
    })
  })

  it('MOVE via one-transaction delete+insert (uid preserved) → NO report — zero traffic', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p0', 'intro'), paragraph('p1', 'hello')),
    })
    const sink = attachSink(created.editor)
    const records: CommentAnchorRecord[] = [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }]
    seedComments(created.editor, records)

    // The drag-move shape: delete the block and re-insert it elsewhere in the
    // SAME transaction. The uid layer keeps the id (source gone → no
    // collision), and node-local offsets are move-invariant.
    const block = created.editor.state.doc.child(1)
    const tr = created.editor.state.tr
    tr.delete(7, 14)
    tr.insert(0, block)
    created.editor.view.dispatch(tr)
    expect(created.editor.state.doc.child(0).attrs.uid).toBe('p1')

    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).not.toHaveBeenCalled()
    // And nothing rewrote the stored anchors either.
    expect(getCommentsStorage(created.editor)!.comments).toBe(records)
  })

  it('cut/paste-shaped restoration stays silent — revival lands exactly on the baseline', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p0', 'intro'), paragraph('p1', 'hello')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [
      { id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }], quote: 'hello' },
    ])

    // Cut (uid leaves the doc)…
    created.editor.view.dispatch(created.editor.state.tr.delete(7, 14))
    // …paste back elsewhere (uid REAPPEARS → revival trigger): the revived
    // geometry derives to the very payload last reported — silence.
    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size,
      paragraph('p1', 'hello'),
    )

    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).not.toHaveBeenCalled()
  })

  it('undo inside the window cancels the pending report — nothing fires', () => {
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 1))
    vi.advanceTimersByTime(400)
    created.editor.commands.undo()

    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).not.toHaveBeenCalled()
  })

  it('dormant segments never travel: writes carry the LIVE segments only (decided)', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello'), paragraph('p2', 'beta')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p2', from: 0, to: 4 },
        ],
      },
    ])

    // Delete the second commented block outright (p2 spans [7, 13)) — its
    // segment goes dormant — and shift the surviving one with a leading edit.
    created.editor.view.dispatch(created.editor.state.tr.delete(7, 13))
    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 1))

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      // Live-only: the row self-cleans to exactly what is highlighted, and
      // every entry the backend receives is one its quote validator can
      // resolve. The dormant seed survives IN SESSION (plugin state) — only
      // the write sheds it.
      nodes: [{ id: 'p1', from: 1, to: 6 }],
      quote: 'hello',
    })
  })

  it('a comment gone ALL-dormant is never reported — a pending report dies with it', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Dirty it (report scheduled)…
    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 1))
    vi.advanceTimersByTime(400)
    // …then delete the whole commented text inside the window. Writing the
    // scheduled payload now would anchor into text that no longer exists —
    // and `nodes: []` would destroy the stored anchor revival still needs.
    created.editor.view.dispatch(created.editor.state.tr.delete(2, 7))

    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).not.toHaveBeenCalled()
  })

  it('a comment removed from storage drops its pending report and timer', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 1))
    vi.advanceTimersByTime(400)
    // Resolved/deleted on the backend → the bridge sheds it from storage.
    seedComments(created.editor, [])

    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).not.toHaveBeenCalled()
  })

  it('destroy delivers the pending report synchronously into the sink', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])

    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 1))
    expect(sink).not.toHaveBeenCalled()

    // No timers advanced: teardown itself must hand the report over — the
    // sink is a queue, not the network, so delivering here is safe.
    created.editor.destroy()
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      nodes: [{ id: 'p1', from: 7, to: 12 }],
      quote: 'world',
    })
  })

  it('multi-block conversion re-mints the uid → the report carries the NEW uid, highlight steady', () => {
    // The stored-uid death trigger: a multi-block setNode births the blocks
    // uid-less and the fill mints fresh (pinned in nodeIdsExtension.test.ts),
    // so not a single live position moves while the stored anchor points at a
    // dead uid — geometry dirt alone would miss it.
    const created = renderEditor([HeadingFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'alpha'), paragraph('p2', 'beta')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p2', from: 0, to: 4 }] }])
    expect(getCommentPosition(created.editor, 'c-1')).toBe(8)

    created.editor.commands.setTextSelection({
      from: 2,
      to: created.editor.state.doc.content.size - 2,
    })
    created.editor.commands.setNode('heading', { level: 2 })

    const newUid = created.editor.state.doc.child(1).attrs.uid as string
    expect(newUid).not.toBe('p2')
    // The highlight never flickered: the live range sat still throughout.
    expect(getCommentPosition(created.editor, 'c-1')).toBe(8)

    vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith({
      id: 'c-1',
      nodes: [{ id: newUid, from: 0, to: 4 }],
      quote: 'beta',
    })
  })

  it('single-block conversion PRESERVES the uid → NO report', () => {
    // The negative of the trigger above: TipTap's single-block setNode copies
    // the attrs (uid included) onto the new node, so the stored id stays
    // alive and nothing is dirty — silence.
    const created = renderEditor([HeadingFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'title')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.commands.setTextSelection(3)
    created.editor.commands.setNode('heading', { level: 2 })
    expect(created.editor.state.doc.child(0).type.name).toBe('heading')
    expect(created.editor.state.doc.child(0).attrs.uid).toBe('p1')

    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).not.toHaveBeenCalled()
  })
})

describe('the save pump seams', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushPendingReports delivers what is still inside the debounce window NOW', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const sink = attachSink(created.editor)
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])

    // Dirty the anchor, then pre-drain BEFORE the window closes — the save
    // pump's first step: the trailing edits of a burst must ride THEIR OWN
    // save cycle instead of stranding in pendingSave until the next one.
    created.editor.view.dispatch(created.editor.state.tr.insertText('x', 1))
    expect(sink).not.toHaveBeenCalled()
    getCommentsStorage(created.editor)!.flushPendingReports?.()
    expect(sink).toHaveBeenCalledTimes(1)

    // The timer that would have delivered it never doubles the report.
    vi.advanceTimersByTime(LONG_AFTER)
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('a document replace notifies onAnchorsReset — the queue-clear hook', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const onReset = vi.fn()
    getCommentsStorage(created.editor)!.onAnchorsReset = onReset
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])
    created.api.setJSON(docOf(paragraph('p1', 'brand new text')))
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
