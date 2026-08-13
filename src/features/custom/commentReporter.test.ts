import { describe, expect, it } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import { renderEditor } from '../../test/editorHarness'
import { HeadingFeature } from '../blocks/heading'
import { HistoryFeature } from '../history'
import {
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

/** The envelope's anchors: what `collectSavePayload` reads through the bridge
 *  — CURRENT canonical payloads of every dirty comment, pull-based. */
const collect = (editor: Editor) => getCommentsStorage(editor)!.collectDirtyAnchors!()

/** The envelope confirmed: the collected payloads become the baselines. */
const confirm = (editor: Editor, reports = collect(editor)) =>
  getCommentsStorage(editor)!.confirmAnchorsSaved!(reports)

describe('anchor dirty ledger (the segments plugin write side)', () => {
  it('edits inside the highlight dirty the anchor — collect derives the FINAL geometry once', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])

    // Two edits — the ledger holds ONE dirty id, and the collect derives the
    // payload from the CURRENT state (never intermediate snapshots).
    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 1))
    created.editor.view.dispatch(created.editor.state.tr.insertText('Y', 2))

    expect(collect(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 8, to: 13 }], quote: 'world' },
    ])
  })

  it('editing other blocks never dirties — even when the highlight only SHIFTED', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p0', 'intro'), paragraph('p1', 'hello'), paragraph('p2', 'below')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Above the comment: absolute positions shift, node-local ones do not —
    // the recompute lands exactly on the seeded baseline.
    created.editor.view.dispatch(created.editor.state.tr.insertText('XYZ', 1))
    // Below the comment: not even the absolute positions move.
    created.editor.view.dispatch(
      created.editor.state.tr.insertText('!', created.editor.state.doc.content.size - 1),
    )

    expect(collect(created.editor)).toEqual([])
  })

  it('split collects 2 segments (both uids correct); the merge back collects 1', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'helloworld')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 10 }] }])

    // Split after 'hello' (abs 6): the second half re-mints (copy collision),
    // and the derivation must pick the FRESH uid up from the landed doc.
    created.editor.view.dispatch(created.editor.state.tr.split(6))
    const secondUid = created.editor.state.doc.child(1).attrs.uid as string
    expect(secondUid).not.toBe('p1')

    expect(collect(created.editor)).toEqual([
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: secondUid, from: 0, to: 5 },
        ],
        quote: 'helloworld',
      },
    ])
    confirm(created.editor)

    // Join the blocks again (delete the close+open tokens): the live ranges
    // coalesce and the next envelope carries ONE segment.
    created.editor.view.dispatch(created.editor.state.tr.delete(6, 8))
    expect(collect(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 10 }], quote: 'helloworld' },
    ])
  })

  it('MOVE via one-transaction delete+insert (uid preserved) → nothing dirty — zero traffic', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p0', 'intro'), paragraph('p1', 'hello')),
    })
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

    expect(collect(created.editor)).toEqual([])
    // And nothing rewrote the stored anchors either.
    expect(getCommentsStorage(created.editor)!.comments).toBe(records)
  })

  it('cut/paste-shaped restoration stays clean — revival lands exactly on the baseline', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p0', 'intro'), paragraph('p1', 'hello')),
    })
    seedComments(created.editor, [
      { id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }], quote: 'hello' },
    ])

    // Cut (uid leaves the doc)…
    created.editor.view.dispatch(created.editor.state.tr.delete(7, 14))
    // …paste back elsewhere (uid REAPPEARS → revival trigger): the revived
    // geometry derives to the very payload of the baseline — clean.
    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size,
      paragraph('p1', 'hello'),
    )

    expect(collect(created.editor)).toEqual([])
  })

  it('an edit undone within the cycle silences itself — nothing to collect', () => {
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 1))
    created.editor.commands.undo()

    expect(collect(created.editor)).toEqual([])
  })

  it('dormant segments never travel: collects carry the LIVE segments only (decided)', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello'), paragraph('p2', 'beta')),
    })
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

    // Live-only: the row self-cleans to exactly what is highlighted, and
    // every entry the backend receives is one its quote validator can
    // resolve. The dormant seed survives IN SESSION (plugin state) — only
    // the write sheds it.
    expect(collect(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 1, to: 6 }], quote: 'hello' },
    ])
  })

  it('a comment gone ALL-dormant collects the DETACH write — the row must not outlive its text', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Dirty it…
    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 1))
    // …then delete the whole commented text. Every entry snapshots the text
    // it covered and none still resolves to it — the death is PROVEN, so the
    // write clears the stored row. Leaving the stale anchor was the ghost
    // factory: the next reload clamped it over whatever text sat there.
    created.editor.view.dispatch(created.editor.state.tr.delete(2, 7))

    expect(collect(created.editor)).toEqual([{ id: 'c-1', nodes: [], quote: '' }])

    // Confirmed, the detach IS the baseline: nothing re-reports, not even
    // after unrelated edits (in-session revival still owns the tombstone).
    confirm(created.editor, [{ id: 'c-1', nodes: [], quote: '' }])
    expect(collect(created.editor)).toEqual([])
    created.editor.view.dispatch(created.editor.state.tr.insertText('Y', 1))
    expect(collect(created.editor)).toEqual([])
  })

  it('a one-transaction MOVE never detaches — the stored anchor still resolves to its text', () => {
    // The drag/normalizer/cell-merge shape: delete + reinsert in ONE
    // transaction. Every live range collapses through the mapping (the
    // mapping has no concept of a move), yet the block lands intact under
    // the SAME uid — the stored address still resolves to the snapshot, the
    // row is still true, and erasing it would destroy a valid anchor.
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'alpha'), paragraph('p2', 'beta')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    const blockA = created.editor.state.doc.child(0)
    const tr = created.editor.state.tr.delete(0, blockA.nodeSize)
    tr.insert(tr.doc.content.size, blockA)
    created.editor.view.dispatch(tr)

    expect(collect(created.editor)).toEqual([])
  })

  it('an unresolvable segment is no proof of death — the stale half holds the whole row', () => {
    // One segment on a present block, one on a uid this document never had
    // (a stale row from another version). Deleting the present half proves
    // ITS death but not the absent one's — a drifted local doc must not
    // erase a row that may still be true for the saved one. Conservative
    // hold: no detach ships; the row stays stale-but-recoverable.
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p9', from: 0, to: 4 },
        ],
      },
    ])

    created.editor.view.dispatch(created.editor.state.tr.delete(1, 6))

    expect(collect(created.editor)).toEqual([])
  })

  it('a comment removed from storage drops out of the ledger', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 1))
    // Resolved/deleted on the backend → the bridge sheds it from storage.
    seedComments(created.editor, [])

    expect(collect(created.editor)).toEqual([])
  })

  it('multi-block conversion re-mints the uid → the collect carries the NEW uid, highlight steady', () => {
    // The stored-uid death trigger: a multi-block setNode births the blocks
    // uid-less and the fill mints fresh (pinned in nodeIdsExtension.test.ts),
    // so not a single live position moves while the stored anchor points at a
    // dead uid — geometry dirt alone would miss it.
    const created = renderEditor([HeadingFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'alpha'), paragraph('p2', 'beta')),
    })
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

    expect(collect(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: newUid, from: 0, to: 4 }], quote: 'beta' },
    ])
  })

  it('single-block conversion PRESERVES the uid → nothing dirty', () => {
    // The negative of the trigger above: TipTap's single-block setNode copies
    // the attrs (uid included) onto the new node, so the stored id stays
    // alive and nothing is dirty.
    const created = renderEditor([HeadingFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'title')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.commands.setTextSelection(3)
    created.editor.commands.setNode('heading', { level: 2 })
    expect(created.editor.state.doc.child(0).type.name).toBe('heading')
    expect(created.editor.state.doc.child(0).attrs.uid).toBe('p1')

    expect(collect(created.editor)).toEqual([])
  })
})

describe('the envelope seams (collect / confirm)', () => {
  it('collect is READ-ONLY — two collects in a row return the same payloads', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])
    created.editor.view.dispatch(created.editor.state.tr.insertText('x', 1))

    const first = collect(created.editor)
    expect(first).toHaveLength(1)
    expect(collect(created.editor)).toEqual(first)
  })

  it('confirm lands the baselines: the next collect is empty, the next edit dirties again', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])

    created.editor.view.dispatch(created.editor.state.tr.insertText('x', 1))
    confirm(created.editor)
    expect(collect(created.editor)).toEqual([])

    created.editor.view.dispatch(created.editor.state.tr.insertText('y', 2))
    expect(collect(created.editor)).toHaveLength(1)
  })

  it('dirt that lands AFTER a collect survives confirming the OLDER payloads — the token law', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])

    // Envelope 1 snapshots…
    created.editor.view.dispatch(created.editor.state.tr.insertText('x', 1))
    const collected = collect(created.editor)
    // …the user keeps typing while it is in flight…
    created.editor.view.dispatch(created.editor.state.tr.insertText('yz', 2))
    // …the envelope confirms: ONLY the collected payloads become baselines —
    // the newer geometry is still dirty and rides the next envelope.
    confirm(created.editor, collected)
    expect(collect(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 9, to: 14 }], quote: 'world' },
    ])
  })

  it('a document replace resets the ledger against the fresh baselines', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])
    created.editor.view.dispatch(created.editor.state.tr.insertText('x', 1))
    expect(collect(created.editor)).toHaveLength(1)

    created.api.setJSON(docOf(paragraph('p1', 'brand new text')))
    expect(collect(created.editor)).toEqual([])
  })

  it('the seams unregister on destroy', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const storage = getCommentsStorage(created.editor)!
    expect(storage.collectDirtyAnchors).not.toBeNull()
    created.editor.destroy()
    expect(storage.collectDirtyAnchors).toBeNull()
    expect(storage.confirmAnchorsSaved).toBeNull()
    expect(storage.dirtyAnchorIds).toBeNull()
  })
})

/* The confirm reconciles BOTH directions against the baseline the envelope
 * just persisted — the undo-during-flight case the delete-only version lost:
 * the sweep un-dirties an id that returned to its OLD baseline, so only the
 * confirm can notice the document no longer matches what was saved. */
describe('confirm reconciles against the persisted baseline', () => {
  it('an UNDO during the envelope flight re-dirties the anchor — the next one corrects it', () => {
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])

    // Envelope 1 snapshots the edited geometry…
    created.editor.view.dispatch(created.editor.state.tr.insertText('x', 1))
    const collected = collect(created.editor)
    expect(collected).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 7, to: 12 }], quote: 'world' },
    ])

    // …the user undoes while it is in flight (the sweep un-dirties: the
    // payload is back on the OLD baseline)…
    created.editor.commands.undo()
    // …and the envelope lands: the server now holds the EDITED doc + anchor,
    // while the editor shows the reverted one. The mismatch must ride the
    // next envelope instead of being lost.
    confirm(created.editor, collected)
    expect(collect(created.editor)).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }], quote: 'world' },
    ])
  })

  it('a matching confirm still cleans the ledger — no permanent dirt', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])
    created.editor.view.dispatch(created.editor.state.tr.insertText('x', 1))
    confirm(created.editor)
    expect(collect(created.editor)).toEqual([])
  })
})
