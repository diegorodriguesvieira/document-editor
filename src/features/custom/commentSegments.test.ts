import { describe, expect, it } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import { renderEditor } from '../../test/editorHarness'
import { HistoryFeature } from '../history'
import { HeaderFooterFeature } from './headerFooter'
import { VariableFeature } from './variable'
import {
  CommentsFeature,
  getCommentAnchorState,
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

/** What CommentsLayer does after mutating the storage: a no-op dispatch. */
function nudge(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
}

/** The storage+nudge idiom: land the anchor list in storage, then dispatch a
 *  no-op so the plugin's membership reconcile sees it. */
function seedComments(editor: Editor, comments: CommentAnchorRecord[]) {
  getCommentsStorage(editor)!.comments = comments
  nudge(editor)
}

const spans = (editor: Editor) => [...editor.view.dom.querySelectorAll('span.comment')]
const spanTexts = (editor: Editor) => spans(editor).map((span) => span.textContent)

const click = (editor: Editor, pos: number) =>
  editor.view.someProp('handleClick', (fn) => fn(editor.view, pos, new MouseEvent('click')))

describe('comment segments plugin (external nodes[] anchors)', () => {
  it('seeds from storage and paints exactly the stored range', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })

    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    const span = created.editor.view.dom.querySelector('span.comment')
    expect(span?.textContent).toBe('hello')
    expect(span?.getAttribute('data-comment-id')).toBe('c-1')
    expect(span?.getAttribute('data-comment-ids')).toBe('c-1')
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(getCommentPosition(created.editor, 'c-1')).toBe(1)
    // The anchor lives OUTSIDE the document — no mark ever entered it.
    expect(JSON.stringify(created.editor.getJSON())).not.toContain('comment')
  })

  it('walks a cross-block comment through partial down to orphaned', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p0', 'intro'), paragraph('p1', 'alpha'), paragraph('p2', 'beta')),
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
    expect(spanTexts(created.editor)).toEqual(['alpha', 'beta'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')

    // Delete the second commented paragraph entirely: p2 spans [14, 20).
    created.editor.view.dispatch(created.editor.state.tr.delete(14, 20))
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('partial')
    expect(spanTexts(created.editor)).toEqual(['alpha'])

    // Delete the first one too: p1 spans [7, 14).
    created.editor.view.dispatch(created.editor.state.tr.delete(7, 14))
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')
    expect(spans(created.editor)).toEqual([])
    expect(getCommentPosition(created.editor, 'c-1')).toBeNull()
  })

  it('maps through edits: glued to its text, edge typing lands outside', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 6, to: 11 }] }])
    expect(spanTexts(created.editor)).toEqual(['world'])

    // Typing BEFORE the highlight shifts it along.
    created.editor.view.dispatch(created.editor.state.tr.insertText('XX', 1))
    expect(spanTexts(created.editor)).toEqual(['world'])
    expect(getCommentPosition(created.editor, 'c-1')).toBe(9)

    // Typing AT the start edge stays outside (bias +1)…
    created.editor.view.dispatch(created.editor.state.tr.insertText('A', 9))
    expect(spanTexts(created.editor)).toEqual(['world'])
    expect(getCommentPosition(created.editor, 'c-1')).toBe(10)
    // …and at the end edge too (bias -1): live is (10, 15), type at 15.
    created.editor.view.dispatch(created.editor.state.tr.insertText('B', 15))
    expect(spanTexts(created.editor)).toEqual(['world'])
  })

  it('closes the seam: adjacent stored segments coalesce, junction typing grows ONE highlight', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'helloworld')),
    })
    // Two stored segments that TOUCH — the split-then-report shape.
    seedComments(created.editor, [
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p1', from: 5, to: 10 },
        ],
      },
    ])
    // Seed-time normalization already fused them: one span, not two.
    expect(spanTexts(created.editor)).toEqual(['helloworld'])

    // THE SEAM-HOLE PIN: typing exactly at the junction (abs 6) must grow the
    // single highlight — with two separate ranges both biases would push away
    // from the caret and leave a permanent gap.
    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 6))
    expect(spanTexts(created.editor)).toEqual(['helloXworld'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
  })

  it('bounds growth: a block merge coalesces the live ranges back to one', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello'), paragraph('p2', 'world')),
    })
    seedComments(created.editor, [
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p2', from: 0, to: 5 },
        ],
      },
    ])
    expect(spanTexts(created.editor)).toEqual(['hello', 'world'])

    // Join the blocks (backspace at block start): the two live ranges land
    // touching and must fuse — nodes[] stays bounded through split/merge.
    created.editor.view.dispatch(created.editor.state.tr.delete(6, 8))
    expect(spanTexts(created.editor)).toEqual(['helloworld'])

    // And the junction behaves like one range from here on.
    created.editor.view.dispatch(created.editor.state.tr.insertText('X', 6))
    expect(spanTexts(created.editor)).toEqual(['helloXworld'])
  })

  it('ANTI-GHOST: deleting the commented words kills the highlight for good', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // Select-and-delete exactly the commented words — the block SURVIVES.
    created.editor.view.dispatch(created.editor.state.tr.delete(1, 6))
    expect(spans(created.editor)).toEqual([])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')

    // The ghost-resurrection regression pin: new text at the stored offsets
    // must NOT re-light — the tombstone holds through ordinary typing.
    created.editor.view.dispatch(created.editor.state.tr.insertText('typed', 1))
    expect(spans(created.editor)).toEqual([])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')
  })

  it('revives on undo — the history meta trigger', () => {
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    created.editor.view.dispatch(created.editor.state.tr.delete(1, 6))
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')

    created.editor.commands.undo()

    expect(spanTexts(created.editor)).toEqual(['hello'])
    expect(getCommentPosition(created.editor, 'c-1')).toBe(1)
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
  })

  it('revives when the uid REAPPEARS — cut/paste-shaped restoration, zero storage traffic', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p0', 'intro'), paragraph('p1', 'hello')),
    })
    const storedComments: CommentAnchorRecord[] = [
      { id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] },
    ]
    seedComments(created.editor, storedComments)

    // Delete the whole commented block: p1 spans [7, 14).
    created.editor.view.dispatch(created.editor.state.tr.delete(7, 14))
    expect(spans(created.editor)).toEqual([])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')

    // Paste-back the same block JSON, SAME uid, at the end of the document.
    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size,
      paragraph('p1', 'hello'),
    )

    expect(spanTexts(created.editor)).toEqual(['hello'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(getCommentPosition(created.editor, 'c-1')).toBe(8)
    // Nothing wrote to storage — offsets are move-invariant under the uid.
    expect(getCommentsStorage(created.editor)!.comments).toBe(storedComments)
  })

  it('setJSON re-seeds every comment — tombstones cleared with the same transaction', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'beta')),
    })
    const original = created.api.getJSON() // same uids, captured pre-edit
    seedComments(created.editor, [
      { id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] },
      { id: 'c-2', nodes: [{ id: 'p2', from: 0, to: 4 }] },
    ])

    // Tombstone c-1 the anti-ghost way (text gone, block survives).
    created.editor.view.dispatch(created.editor.state.tr.delete(1, 6))
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')
    expect(spanTexts(created.editor)).toEqual(['beta'])

    // Reload the SAME document: the documentReplaced meta re-seeds everything
    // from storage — including the previously tombstoned comment, whose text
    // exists again in the reloaded doc.
    created.api.setJSON(original)

    expect(spanTexts(created.editor)).toEqual(['hello', 'beta'])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(getCommentAnchorState(created.editor, 'c-2')).toBe('anchored')
  })

  it('the header/footer normalizer tombstones without detaching — the stored anchor survives a region rewrite', () => {
    // The REAL one-transaction full-document rewrite: content landing before
    // the header violates the region invariant, and HeaderFooterGuard's
    // appendTransaction rewrites the whole doc in ONE ReplaceStep to restore
    // order. The mapping has no concept of a move, so every live range wipes
    // and the comment tombstones — while the very same paragraph, same uid,
    // same text, lands reordered. The reporter must treat that as a MOVE
    // (silence — the stored row is still true), never as a death; a reload
    // then restores the highlight from the untouched record.
    const created = renderEditor([HeaderFooterFeature, CommentsFeature], {
      content: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'documentHeader',
              attrs: { uid: 'hdr' },
              content: [paragraph('hp', 'Company header')],
            },
            paragraph('p1', 'hello world'),
          ],
        },
      },
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])
    expect(spanTexts(created.editor)).toEqual(['hello'])

    // Disorder the regions: a paragraph inserted BEFORE the header. The
    // guard's normalize fires in the same dispatch's fixpoint.
    created.editor.commands.insertContentAt(0, {
      type: 'paragraph',
      attrs: { uid: 'p0' },
      content: [{ type: 'text', text: 'intro' }],
    })

    // The header is back on top (the normalizer really ran)…
    expect(created.editor.state.doc.firstChild?.type.name).toBe('documentHeader')
    // …the in-session highlight is lost to the rewrite (known limitation —
    // the tombstone holds it)…
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')
    // …and NOTHING ships: the stored address still resolves to its snapshot,
    // so the detach adjudication reads this as a move and stays silent.
    expect(getCommentsStorage(created.editor)!.collectDirtyAnchors!()).toEqual([])

    // A reload (documentReplaced) re-seeds from the untouched record: the
    // anchor was never erased, so the highlight comes straight back.
    created.api.setJSON(created.api.getJSON())
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(spanTexts(created.editor)).toEqual(['hello'])
  })

  it('slices overlaps: stacked class, both ids listed, innermost owns the slice', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    seedComments(created.editor, [
      { id: 'c-outer', nodes: [{ id: 'p1', from: 0, to: 11 }] },
      { id: 'c-inner', nodes: [{ id: 'p1', from: 3, to: 8 }] },
    ])

    // Disjoint segmentation: [1,4) outer, [4,9) both, [9,12) outer.
    const slices = spans(created.editor)
    expect(slices.map((slice) => slice.textContent)).toEqual(['hel', 'lo wo', 'rld'])

    const [head, middle, tail] = slices
    expect(middle.classList.contains('comment--stacked')).toBe(true)
    expect(middle.getAttribute('data-comment-ids')).toBe('c-outer c-inner')
    // Innermost = smallest TOTAL covered length (5 < 11).
    expect(middle.getAttribute('data-comment-id')).toBe('c-inner')
    for (const outerOnly of [head, tail]) {
      expect(outerOnly.classList.contains('comment--stacked')).toBe(false)
      expect(outerOnly.getAttribute('data-comment-id')).toBe('c-outer')
      expect(outerOnly.getAttribute('data-comment-ids')).toBe('c-outer')
    }

    // The scroll-target guarantee: a fully contained comment stays reachable
    // through the word-list selector even though it never renders alone.
    expect(created.editor.view.dom.querySelectorAll('[data-comment-ids~="c-inner"]')).toHaveLength(1)
    expect(created.editor.view.dom.querySelectorAll('[data-comment-ids~="c-outer"]')).toHaveLength(3)
  })

  it('lights EVERY slice of the active multi-range comment — and only its slices', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'alpha'), paragraph('p2', 'beta'), paragraph('p3', 'gamma')),
    })
    seedComments(created.editor, [
      {
        id: 'c-multi',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p3', from: 0, to: 5 },
        ],
      },
      { id: 'c-other', nodes: [{ id: 'p2', from: 0, to: 4 }] },
    ])

    getCommentsStorage(created.editor)!.activeId = 'c-multi'
    nudge(created.editor)

    const lit = [...created.editor.view.dom.querySelectorAll('.comment--active')]
    expect(lit.map((el) => el.textContent)).toEqual(['alpha', 'gamma'])
  })

  it('click: innermost by TOTAL covered length, not hull; miss reports null', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'plain')),
    })
    seedComments(created.editor, [
      // Whole phrase — total 11.
      { id: 'c-wide', nodes: [{ id: 'p1', from: 0, to: 11 }] },
      // Two ranges — total 8, though its HULL spans the whole phrase too.
      {
        id: 'c-multi',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p1', from: 8, to: 11 },
        ],
      },
      { id: 'c-word', nodes: [{ id: 'p1', from: 2, to: 4 }] },
    ])
    const clicks: Array<string | null> = []
    getCommentsStorage(created.editor)!.onCommentClick = (id) => clicks.push(id)

    click(created.editor, 3) // inside all three → totals: wide 11, multi 8, word 2
    click(created.editor, 10) // wide + multi's second range → multi (8 < 11)
    click(created.editor, 15) // second paragraph → off every highlight

    expect(clicks).toEqual(['c-word', 'c-multi', null])
  })

  it('read-only zero-write pin: anchor churn never writes the document', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    created.editor.setEditable(false)
    const initial = created.api.getJSON()
    let docChangedUpdates = 0
    created.editor.on('update', ({ transaction }) => {
      if (transaction.docChanged) docChangedUpdates += 1
    })

    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])
    getCommentsStorage(created.editor)!.activeId = 'c-1'
    nudge(created.editor)
    // Decorations DO paint in read-only mode — review is where they matter…
    expect(spanTexts(created.editor)).toEqual(['hello'])
    seedComments(created.editor, [])
    expect(spans(created.editor)).toEqual([])
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])

    // …but the document itself never moved: no doc-changing update, and the
    // JSON round-trips deep-equal.
    expect(docChangedUpdates).toBe(0)
    expect(created.api.getJSON()).toEqual(initial)
  })
})

/* Revival correctness — the truth gate. A revival must land on EXACTLY the
 * text that went dormant; the collapse-time snapshot (refreshed stored +
 * covered text) is what makes that checkable. These pin the two data-loss
 * bugs the review reproduced: stale-seed revival after pre-dormancy drift,
 * and the unrelated-undo ghost over replacement text. */
describe('revival truth gate', () => {
  it('undo after pre-dormancy drift revives on the DRIFTED range, not the seed', () => {
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'alpha'), paragraph('p2', 'hello world')),
    })
    seedComments(created.editor, [
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p2', from: 6, to: 11 },
        ],
      },
    ])
    expect(spanTexts(created.editor)).toEqual(['alpha', 'world'])

    // Drift: type "say " at p2's content start — live follows "world"…
    created.editor.view.dispatch(created.editor.state.tr.insertText('say ', 8))
    expect(spanTexts(created.editor)).toEqual(['alpha', 'world'])
    // …collapse: delete "world" (now abs [18, 23)) — segment dormant…
    created.editor.view.dispatch(created.editor.state.tr.delete(18, 23))
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('partial')

    // …undo restores it: the revival must paint "world", not the stale-seed
    // range ("llo w") the pre-fix code resolved.
    created.editor.commands.undo()
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(spanTexts(created.editor)).toEqual(['alpha', 'world'])
  })

  it('cut + paste-back revives on the collapse-time snapshot, not the seed', () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'alpha'), paragraph('p2', 'hello world')),
    })
    seedComments(created.editor, [
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p2', from: 6, to: 11 },
        ],
      },
    ])
    created.editor.view.dispatch(created.editor.state.tr.insertText('say ', 8))
    expect(spanTexts(created.editor)).toEqual(['alpha', 'world'])

    // Cut the whole p2 block — uid leaves the doc, segment dormant.
    const block = created.editor.state.doc.child(1)
    created.editor.view.dispatch(created.editor.state.tr.delete(7, 7 + block.nodeSize))
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('partial')

    // Paste it back verbatim: reappearance revival resolves the REFRESHED
    // offsets ({p2, 10, 15}) and still covers "world".
    created.editor.commands.insertContentAt(created.editor.state.doc.content.size, block.toJSON())
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(spanTexts(created.editor)).toEqual(['alpha', 'world'])
  })

  it('a range containing a CHIP revives too — snapshot and gate share the quote norm', () => {
    // The norm-mismatch pin: dormantText is textForSegments output (atoms
    // quote NOTHING), so a gate comparing the placeholder norm (atoms count
    // one space) could never match a chip-containing range — cut a chip
    // range, put it back, and the highlight stayed dead forever.
    const created = renderEditor([VariableFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'alpha'), {
        type: 'paragraph',
        attrs: { uid: 'p2' },
        content: [
          { type: 'text', text: 'pay ' },
          { type: 'variable', attrs: { id: 'client.name', label: 'Client name', uid: 'v1' } },
          { type: 'text', text: ' now' },
        ],
      }),
    })
    seedComments(created.editor, [
      {
        id: 'c-1',
        nodes: [
          { id: 'p1', from: 0, to: 5 },
          { id: 'p2', from: 0, to: 9 },
        ],
      },
    ])
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')

    // Cut the whole chip-carrying block — uid leaves, segment goes dormant
    // with the quote-norm snapshot 'pay  now'.
    const block = created.editor.state.doc.child(1)
    created.editor.view.dispatch(created.editor.state.tr.delete(7, 7 + block.nodeSize))
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('partial')

    // Programmatic re-insertion: no clipboard, no carry — the reappearance
    // gate alone decides, and it must accept its own snapshot's norm.
    created.editor.commands.insertContentAt(created.editor.state.doc.content.size, block.toJSON())
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    // The inline decoration is sliced around the atom — assert the covered
    // text, not the span count.
    expect(spanTexts(created.editor)[0]).toBe('alpha')
    expect(spanTexts(created.editor).join('')).toContain('pay ')
    expect(spanTexts(created.editor).join('')).toContain(' now')
  })

  it('an unrelated undo never revives a tombstone over REPLACEMENT text', () => {
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'hello'), paragraph('p2', 'beta')),
    })
    seedComments(created.editor, [{ id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] }])
    expect(spanTexts(created.editor)).toEqual(['hello'])

    // Kill the commented text (tombstone), replace it with other words.
    created.editor.view.dispatch(created.editor.state.tr.delete(1, 6))
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')
    created.editor.view.dispatch(created.editor.state.tr.insertText('adieu', 1))
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')

    // Undo an UNRELATED edit (typing in p2): stored [0, 5) resolves to
    // "adieu" — the truth gate ("hello") must keep the tombstone dead.
    created.editor.view.dispatch(created.editor.state.tr.insertText('x', 8))
    created.editor.commands.undo()
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('orphaned')
    expect(spanTexts(created.editor)).toEqual([])

    // The GENUINE restoration still revives: undo back to "hello".
    created.editor.commands.undo() // un-insert "adieu"
    created.editor.commands.undo() // un-delete "hello"
    expect(getCommentAnchorState(created.editor, 'c-1')).toBe('anchored')
    expect(spanTexts(created.editor)).toEqual(['hello'])
  })

  it('a seeded dormant (no snapshot) revives on uid reappearance, never on a history tick', () => {
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docOf(paragraph('p1', 'alpha')),
    })
    seedComments(created.editor, [{ id: 'c-9', nodes: [{ id: 'p-gone', from: 0, to: 5 }] }])
    expect(getCommentAnchorState(created.editor, 'c-9')).toBe('orphaned')

    // A bare history tick must not resolve blind seed offsets…
    created.editor.view.dispatch(created.editor.state.tr.insertText('x', 1))
    created.editor.commands.undo()
    expect(getCommentAnchorState(created.editor, 'c-9')).toBe('orphaned')

    // …but the uid REAPPEARING is the strong signal: node-local offsets bind.
    created.editor.commands.insertContentAt(
      created.editor.state.doc.content.size,
      paragraph('p-gone', 'hello'),
    )
    expect(getCommentAnchorState(created.editor, 'c-9')).toBe('anchored')
    expect(spanTexts(created.editor)).toEqual(['hello'])
  })
})
