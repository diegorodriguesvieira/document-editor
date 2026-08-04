import { describe, expect, it, vi } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import { docWith, parseSliceFromHTML, renderEditor } from '../../test/editorHarness'
import { HistoryFeature } from '../history'
import { VariableFeature } from './variable'
import { CommentsFeature, getCommentsStorage } from './comments'
import {
  applyCommentAnchor,
  collectCommentAnchors,
  stripDanglingCommentAnchors,
} from './commentAnchors'

/** A one-paragraph doc where `text` (inside "hello world") carries the mark. */
const commentedDoc = (id: string | null): { doc: JSONContent } => ({
  doc: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            marks: [id == null ? { type: 'comment' } : { type: 'comment', attrs: { commentId: id } }],
            text: 'hello',
          },
          { type: 'text', text: ' world' },
        ],
      },
    ],
  },
})

/** What CommentsLayer does after mutating the storage: a no-op dispatch. */
function nudge(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
}

describe('comment mark (the in-document anchor)', () => {
  it('declares the agreed schema: non-inclusive edges, overlap allowed', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    // Typing at a highlight's edge must not grow the comment…
    expect(created.editor.schema.marks.comment.spec.inclusive).toBe(false)
    // …and two comments may cover the same text (nested marks).
    expect(created.editor.schema.marks.comment.spec.excludes).toBe('')
  })

  it('renders as a .comment span and SERIALIZES — the anchor is part of the document', () => {
    const created = renderEditor([CommentsFeature], { content: commentedDoc('c-1') })

    const span = created.editor.view.dom.querySelector('span.comment[data-comment-id="c-1"]')
    expect(span?.textContent).toBe('hello')
    // Marks serialize (decorations never did): the anchor survives save/load.
    expect(created.api.getHTML()).toContain('data-comment-id="c-1"')
    expect(JSON.stringify(created.editor.getJSON())).toContain('"commentId":"c-1"')
    // The default (editable) editor — highlights exist in edit mode too.
    expect(created.editor.isEditable).toBe(true)
  })

  it('applyCommentAnchor marks the range off-history (undo must never shed anchors)', () => {
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docWith('hello world'),
    })

    expect(applyCommentAnchor(created.editor, 'c-9', { from: 1, to: 6 })).toBe(true)

    expect(
      created.editor.view.dom.querySelector('[data-comment-id="c-9"]')?.textContent,
    ).toBe('hello')
    expect(created.editor.can().undo()).toBe(false)
  })

  it('applyCommentAnchor clamps stale ranges and bails on collapsed ones', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })

    // Fully past the doc: nothing to mark, no dispatch.
    expect(applyCommentAnchor(created.editor, 'c-beyond', { from: 500, to: 900 })).toBe(false)
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-beyond"]')).toBeNull()
    // Negative start clamps to the doc start.
    expect(applyCommentAnchor(created.editor, 'c-neg', { from: -5, to: 3 })).toBe(true)
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-neg"]')).not.toBeNull()
  })

  it('lets two comments OVERLAP the same text', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })

    applyCommentAnchor(created.editor, 'c-outer', { from: 1, to: 11 })
    applyCommentAnchor(created.editor, 'c-inner', { from: 3, to: 6 })

    const dom = created.editor.view.dom
    expect(dom.querySelector('[data-comment-id="c-outer"]')).not.toBeNull()
    expect(dom.querySelector('[data-comment-id="c-inner"]')).not.toBeNull()
    const anchors = collectCommentAnchors(created.editor.state.doc)
    expect(anchors.get('c-outer')).toMatchObject({ from: 1, to: 11 })
    expect(anchors.get('c-inner')).toMatchObject({ from: 3, to: 6 })
  })

  it('collectCommentAnchors keeps FRAGMENTS as segments under one union span', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })

    applyCommentAnchor(created.editor, 'c-frag', { from: 1, to: 3 })
    applyCommentAnchor(created.editor, 'c-frag', { from: 7, to: 9 })

    const anchor = collectCommentAnchors(created.editor.state.doc).get('c-frag')
    expect(anchor).toMatchObject({ from: 1, to: 9 })
    expect(anchor?.segments).toEqual([
      { from: 1, to: 3 },
      { from: 7, to: 9 },
    ])
  })
})

describe('comment mark on inline atoms (variable chips)', () => {
  /** "ab {{chip}} cd" — the chip sits mid-range so addMark hits it too. */
  const CHIPPED_DOC = {
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ab ' },
            { type: 'variable', attrs: { id: 'client.name', label: 'Client name' } },
            { type: 'text', text: ' cd' },
          ],
        },
      ],
    },
  }

  it('collects ONE contiguous segment across a chip — and strips the chip clean', () => {
    const created = renderEditor([VariableFeature, CommentsFeature], { content: CHIPPED_DOC })
    // 'ab ' = 1..4, chip = 4..5, ' cd' = 5..8 — the anchor spans all three
    // inline nodes, chip included (that is what tr.addMark does).
    applyCommentAnchor(created.editor, 'c-1', { from: 1, to: 8 })

    const anchor = collectCommentAnchors(created.editor.state.doc).get('c-1')
    // The chip must not fragment the anchor: text–chip–text is ONE segment.
    expect(anchor?.segments).toEqual([{ from: 1, to: 8 }])

    // Stripping must reach the chip too — a text-only walk would leave a
    // permanent ghost highlight on it.
    stripDanglingCommentAnchors(created.editor, new Set())
    expect(created.editor.view.dom.querySelector('[data-comment-id]')).toBeNull()
    expect(JSON.stringify(created.editor.getJSON())).not.toContain('commentId')
  })
})

describe('comments kernel (draft/active emphasis + click reporting)', () => {
  it('lights the ACTIVE comment per segment — a fragmented mark leaves its gap dark', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    applyCommentAnchor(created.editor, 'c-frag', { from: 1, to: 3 })
    applyCommentAnchor(created.editor, 'c-frag', { from: 7, to: 9 })

    getCommentsStorage(created.editor)!.activeId = 'c-frag'
    nudge(created.editor)

    const lit = [...created.editor.view.dom.querySelectorAll('.comment--active')]
    expect(lit.map((el) => el.textContent)).toEqual(['he', 'wo'])
  })

  it('shows the range being composed (the captured draft) as comment--draft', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    created.editor.setEditable(false)

    getCommentsStorage(created.editor)!.draft = { from: 7, to: 12, quote: 'world' }
    nudge(created.editor)

    expect(created.editor.view.dom.querySelector('span.comment--draft')?.textContent).toBe('world')
  })

  it('reports the INNERMOST hit to onCommentClick — and null when clicking off-highlight', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    created.editor.setEditable(false)
    applyCommentAnchor(created.editor, 'c-outer', { from: 1, to: 11 })
    applyCommentAnchor(created.editor, 'c-inner', { from: 3, to: 6 })
    const clicks: Array<string | null> = []
    getCommentsStorage(created.editor)!.onCommentClick = (id) => clicks.push(id)
    const click = (pos: number) =>
      created.editor.view.someProp('handleClick', (fn) =>
        fn(created.editor.view, pos, new MouseEvent('click')),
      )

    click(4) // inside both → the smaller range wins
    click(10) // only the outer one covers it
    click(12) // past both → deactivates

    expect(clicks).toEqual(['c-inner', 'c-outer', null])
  })

  it('reports in EDIT mode too — highlights are part of the document now', () => {
    const created = renderEditor([CommentsFeature], { content: commentedDoc('c-1') })
    expect(created.editor.isEditable).toBe(true)
    const clicks: Array<string | null> = []
    getCommentsStorage(created.editor)!.onCommentClick = (id) => clicks.push(id)

    created.editor.view.someProp('handleClick', (fn) =>
      fn(created.editor.view, 3, new MouseEvent('click')),
    )

    expect(clicks).toEqual(['c-1'])
  })
})

describe('comments reconciliation + paste hygiene', () => {
  it('stripDanglingCommentAnchors keeps known ids, sheds unknown and id-less marks', () => {
    const created = renderEditor([CommentsFeature], { content: commentedDoc(null) })
    applyCommentAnchor(created.editor, 'c-keep', { from: 7, to: 10 })
    applyCommentAnchor(created.editor, 'c-gone', { from: 10, to: 12 })

    stripDanglingCommentAnchors(created.editor, new Set(['c-keep']))

    const dom = created.editor.view.dom
    expect(dom.querySelector('[data-comment-id="c-keep"]')).not.toBeNull()
    expect(dom.querySelector('[data-comment-id="c-gone"]')).toBeNull()
    // The id-less mark (hand-crafted JSON) is gone too: only one span left.
    expect(dom.querySelectorAll('span.comment')).toHaveLength(1)
  })

  it('stripDanglingCommentAnchors never dispatches on a clean doc', () => {
    const created = renderEditor([CommentsFeature], { content: commentedDoc('c-1') })
    const dispatch = vi.spyOn(created.editor.view, 'dispatch')

    stripDanglingCommentAnchors(created.editor, new Set(['c-1']))

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('an overlapping sibling survives its neighbour being stripped', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    applyCommentAnchor(created.editor, 'c-keep', { from: 1, to: 11 })
    applyCommentAnchor(created.editor, 'c-gone', { from: 3, to: 6 })

    stripDanglingCommentAnchors(created.editor, new Set(['c-keep']))

    expect(collectCommentAnchors(created.editor.state.doc).get('c-keep')).toMatchObject({
      from: 1,
      to: 11,
    })
    expect(collectCommentAnchors(created.editor.state.doc).has('c-gone')).toBe(false)
  })

  it('strips comment marks from pasted slices — copy/paste must not duplicate an id', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    // External (or copied) HTML carrying an anchor span…
    const slice = parseSliceFromHTML(
      created.editor,
      '<p><span data-comment-id="c-alien">hi</span></p>',
    )
    expect(JSON.stringify(slice.toJSON())).toContain('c-alien')

    // PM CHAINS every plugin's transformPasted (the someProp callback's return
    // is discarded) — mirror that: with UniqueID in the kernel, comments' is
    // no longer the only transform in the chain.
    let transformed = slice
    created.editor.view.someProp('transformPasted', (fn) => {
      transformed = fn(transformed, created.editor.view, false)
    })

    expect(JSON.stringify(transformed.toJSON())).not.toContain('comment')
  })
})
