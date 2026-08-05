import { describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import type { DocumentJSON } from './document'
import { NODE_ID_ATTRIBUTE, injectNodeIds } from './nodeIds'
import { UID_REMAPPED_META, type UidRemapMeta } from './nodeIdsExtension'
import { HeadingFeature } from '../../features'
import { collectNodeIds, docWith, renderEditor } from '../../test/editorHarness'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Two stamped paragraphs — enough document to move, cut, and copy around. */
const twoBlocks = (): DocumentJSON => ({
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'alpha' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'beta' }] },
    ],
  },
})

/** Every remap meta the editor emits from now on, in dispatch order. The meta
 *  rides the APPENDED transaction (the one carrying the re-mint step), so the
 *  capture inspects root and appended transactions alike. */
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

describe('NodeIds semantics', () => {
  it('MOVE — delete + reinsert in ONE transaction keeps the uid, no remap', () => {
    const { editor, api } = renderEditor([], { content: injectNodeIds(twoBlocks()) })
    const [uidA, uidB] = collectNodeIds(api.getJSON().doc)
    const remaps = captureRemaps(editor)

    // The drag-move shape without jsdom drag theater: one transaction that
    // deletes block A and inserts the very same node after B.
    const blockA = editor.state.doc.child(0)
    const tr = editor.state.tr.delete(0, blockA.nodeSize)
    tr.insert(tr.doc.content.size, blockA)
    editor.view.dispatch(tr)

    const doc = api.getJSON().doc
    expect(doc.content?.map((block) => block.content?.[0]?.text)).toEqual(['beta', 'alpha'])
    // The old holder died in the same transaction — no collision, ids survive.
    expect(doc.content?.[0]?.attrs?.[NODE_ID_ATTRIBUTE]).toBe(uidB)
    expect(doc.content?.[1]?.attrs?.[NODE_ID_ATTRIBUTE]).toBe(uidA)
    expect(remaps).toEqual([])
  })

  it('CUT + PASTE — the uid left the doc, so pasting it back restores it', () => {
    const { editor, api } = renderEditor([], { content: injectNodeIds(twoBlocks()) })
    const [uidA, uidB] = collectNodeIds(api.getJSON().doc)
    const remaps = captureRemaps(editor)

    const clipboard = editor.state.doc.child(0).toJSON() // copy…
    editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.child(0).nodeSize)) // …cut
    expect(collectNodeIds(api.getJSON().doc)).toEqual([uidB])

    editor.commands.insertContentAt(editor.state.doc.content.size, clipboard) // paste, next transaction
    expect(collectNodeIds(api.getJSON().doc)).toEqual([uidB, uidA])
    expect(remaps).toEqual([])
  })

  it('COPY — a colliding paste re-mints the copy and records new → source', () => {
    const { editor, api } = renderEditor([], { content: injectNodeIds(twoBlocks()) })
    const [uidA] = collectNodeIds(api.getJSON().doc)
    const remaps = captureRemaps(editor)

    const clipboard = editor.state.doc.child(0).toJSON() // copy — source stays put
    editor.commands.insertContentAt(editor.state.doc.content.size, clipboard)

    const doc = api.getJSON().doc
    const ids = collectNodeIds(doc)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(doc.content?.[0]?.attrs?.[NODE_ID_ATTRIBUTE]).toBe(uidA) // original untouched
    const minted = doc.content?.at(-1)?.attrs?.[NODE_ID_ATTRIBUTE] as string
    expect(minted).toMatch(UUID_V4)
    expect(minted).not.toBe(uidA)
    expect(remaps).toHaveLength(1)
    expect(remaps[0]?.size).toBe(1)
    expect(remaps[0]?.get(minted)).toBe(uidA) // the copy-extend feed
  })

  it('COPY above the source — the surviving source keeps the uid, wherever the copy lands', () => {
    // Document order alone would retain the pasted copy (it becomes the FIRST
    // occurrence) and leave the doc duplicated forever — the source-survives
    // refinement is exactly what this pins.
    const { editor, api } = renderEditor([], { content: injectNodeIds(twoBlocks()) })
    const [uidA] = collectNodeIds(api.getJSON().doc)
    const remaps = captureRemaps(editor)

    const clipboard = editor.state.doc.child(0).toJSON()
    editor.commands.insertContentAt(0, clipboard) // paste ABOVE the source

    const doc = api.getJSON().doc
    const ids = collectNodeIds(doc)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(doc.content?.[1]?.attrs?.[NODE_ID_ATTRIBUTE]).toBe(uidA) // source, now second
    const minted = doc.content?.[0]?.attrs?.[NODE_ID_ATTRIBUTE] as string
    expect(minted).not.toBe(uidA)
    expect(remaps[0]?.get(minted)).toBe(uidA)
  })

  it('double-paste of one cut buffer — first restores, second re-mints', () => {
    const { editor, api } = renderEditor([], { content: injectNodeIds(twoBlocks()) })
    const [uidA, uidB] = collectNodeIds(api.getJSON().doc)
    const remaps = captureRemaps(editor)

    const clipboard = editor.state.doc.child(0).toJSON()
    editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.child(0).nodeSize)) // cut

    editor.commands.insertContentAt(editor.state.doc.content.size, clipboard) // paste 1: restore
    expect(collectNodeIds(api.getJSON().doc)).toEqual([uidB, uidA])
    expect(remaps).toEqual([])

    editor.commands.insertContentAt(editor.state.doc.content.size, clipboard) // paste 2: collide
    const ids = collectNodeIds(api.getJSON().doc)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(ids[1]).toBe(uidA) // the restored one is the retained survivor
    const minted = ids[2] as string
    expect(minted).toMatch(UUID_V4)
    expect(remaps).toHaveLength(1)
    expect(remaps[0]?.get(minted)).toBe(uidA)
  })

  it('one insert carrying an internal duplicate keeps the first occurrence only', () => {
    // No survivor exists (the uid is new to the doc), so first-in-document-
    // order wins — the same policy injectNodeIds applies at entry.
    const { editor, api } = renderEditor([], { content: injectNodeIds(docWith('base')) })
    const remaps = captureRemaps(editor)

    editor.commands.insertContentAt(editor.state.doc.content.size, [
      { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: 'twin' }, content: [{ type: 'text', text: 'one' }] },
      { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: 'twin' }, content: [{ type: 'text', text: 'two' }] },
    ])

    const ids = collectNodeIds(api.getJSON().doc)
    expect(ids).toHaveLength(3)
    expect(ids[1]).toBe('twin')
    expect(ids[2]).toMatch(UUID_V4)
    expect(remaps).toHaveLength(1)
    expect(remaps[0]?.get(ids[2] as string)).toBe('twin')
  })

  it('a pasted data-uid unknown to the doc is kept verbatim', () => {
    const { editor, api } = renderEditor([], { content: injectNodeIds(docWith('base')) })
    const remaps = captureRemaps(editor)

    editor.commands.setTextSelection(5) // end of 'base'
    // jsdom has no ClipboardEvent constructor — hand pasteHTML a plain Event
    // so it doesn't try to build one itself.
    const pasteEvent = new Event('paste') as ClipboardEvent
    // Three blocks so the middle one is CLOSED in the slice: the open edges
    // may merge into surrounding blocks, but a closed node lands as parsed,
    // foreign uid included.
    editor.view.pasteHTML(
      '<p data-uid="ghost-head">one</p><p data-uid="ghost-kept">two</p><p data-uid="ghost-tail">three</p>',
      pasteEvent,
    )

    const ids = collectNodeIds(api.getJSON().doc)
    expect(ids).toContain('ghost-kept') // no collision → no re-mint
    expect(new Set(ids).size).toBe(ids.length)
    expect(remaps).toEqual([])
  })

  it('Enter at block START — the content-bearing half keeps the ORIGINAL uid', () => {
    const { editor, api } = renderEditor([], { content: injectNodeIds(docWith('hello')) })
    const [original] = collectNodeIds(api.getJSON().doc)
    const remaps = captureRemaps(editor)

    editor.commands.setTextSelection(1) // caret at the very start of the text
    editor.commands.splitBlock()

    const doc = api.getJSON().doc
    expect(doc.content).toHaveLength(2)
    const [emptyHalf, contentHalf] = doc.content ?? []
    expect(emptyHalf?.content ?? []).toHaveLength(0)
    expect(contentHalf?.content?.[0]?.text).toBe('hello')
    // The empty-first-half transfer: identity follows the content.
    expect(contentHalf?.attrs?.[NODE_ID_ATTRIBUTE]).toBe(original)
    expect(emptyHalf?.attrs?.[NODE_ID_ATTRIBUTE]).toMatch(UUID_V4)
    expect(emptyHalf?.attrs?.[NODE_ID_ATTRIBUTE]).not.toBe(original)
    expect(remaps).toEqual([]) // a transfer is not a collision — no remap
  })

  it('Enter mid-block — the second half re-mints and records the remap', () => {
    // Both halves are born holding the original uid; the trailing half is the
    // newborn, so the collision rule re-mints it. Recording the remap here is
    // deliberate: the rule cannot (and should not) distinguish a split from a
    // paste, and consumers intersect against the copied CONTENT anyway — for
    // an empty or unrelated half the remap simply extends nothing.
    const { editor, api } = renderEditor([], { content: injectNodeIds(docWith('hello')) })
    const [original] = collectNodeIds(api.getJSON().doc)
    const remaps = captureRemaps(editor)

    editor.commands.setTextSelection(3) // he|llo
    editor.commands.splitBlock()

    const doc = api.getJSON().doc
    const [head, tail] = collectNodeIds(doc)
    expect(doc.content?.map((block) => block.content?.[0]?.text)).toEqual(['he', 'llo'])
    expect(head).toBe(original)
    expect(tail).toMatch(UUID_V4)
    expect(tail).not.toBe(original)
    expect(remaps).toHaveLength(1)
    expect(remaps[0]?.get(tail as string)).toBe(original)
  })

  it('single-block type conversion PRESERVES the uid — pinned real behavior', () => {
    // TipTap's single-block `setNode` copies the source block's attrs (uid
    // included) onto the new node, and the old holder dies in the same
    // transaction — a move-shaped change, so the id survives. Plan decision 6
    // accepts either outcome for conversions ("the id MAY change"); this pins
    // what the engine actually does so a change of behavior is loud.
    const { editor, api } = renderEditor([HeadingFeature], {
      content: injectNodeIds(docWith('title')),
    })
    const [original] = collectNodeIds(api.getJSON().doc)
    const remaps = captureRemaps(editor)

    editor.commands.setTextSelection(3)
    editor.commands.setNode('heading', { level: 2 })

    const doc = api.getJSON().doc
    expect(doc.content?.[0]?.type).toBe('heading')
    expect(doc.content?.[0]?.attrs?.[NODE_ID_ATTRIBUTE]).toBe(original)
    expect(remaps).toEqual([])
  })

  it('multi-block type conversion RE-MINTS — pinned real behavior', () => {
    // Across parents TipTap passes only the given attrs, so the headings are
    // born uid-less and the fill mints fresh ids — the "conversion may change
    // the id" side of plan decision 6. No collision → no remap meta.
    const { editor, api } = renderEditor([HeadingFeature], {
      content: injectNodeIds(twoBlocks()),
    })
    const before = collectNodeIds(api.getJSON().doc)
    const remaps = captureRemaps(editor)

    editor.commands.setTextSelection({ from: 2, to: editor.state.doc.content.size - 2 })
    editor.commands.setNode('heading', { level: 2 })

    const doc = api.getJSON().doc
    // The trailing paragraph is BodyTrailingNode cooperating: the body no
    // longer ends in a paragraph, so one is appended (and filled) on the spot.
    expect(doc.content?.map((block) => block.type)).toEqual(['heading', 'heading', 'paragraph'])
    const after = collectNodeIds(doc)
    expect(after).toHaveLength(3)
    for (const id of after) {
      expect(id).toMatch(UUID_V4)
      expect(before).not.toContain(id)
    }
    expect(new Set(after).size).toBe(3)
    expect(remaps).toEqual([])
  })

  it('y-sync transactions are never stamped — remote replicas own their ids', () => {
    const { editor, api } = renderEditor([], { content: injectNodeIds(docWith('base')) })
    const remaps = captureRemaps(editor)

    // A remote-marked transaction inserting an unstamped paragraph: the
    // extension must sit that round out entirely.
    const paragraph = editor.state.schema.nodes.paragraph
    const tr = editor.state.tr.insert(editor.state.doc.content.size, paragraph.create())
    tr.setMeta('y-sync$', {})
    editor.view.dispatch(tr)

    let ids = collectNodeIds(api.getJSON().doc)
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBeNull() // left alone — not filled in that round

    // A normal LOCAL edit whose changed range covers the node fills it.
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'x')
    ids = collectNodeIds(api.getJSON().doc)
    expect(ids[1]).toMatch(UUID_V4)
    expect(remaps).toEqual([])
  })
})

/* The split branch matches ONE shape — empty textblock + same-uid successor.
 * Everything else with content.size 0 must fall through to the collision
 * rule: an early return here once let pasted EMPTY blocks (and leaves) keep a
 * colliding uid forever, permanently breaking uniqueness and orphaning every
 * comment anchored to that uid on the next load. */
describe('collision rule vs the split branch', () => {
  const threeWithEmpty = (): DocumentJSON => ({
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { uid: 'p-alpha' }, content: [{ type: 'text', text: 'alpha' }] },
        { type: 'paragraph', attrs: { uid: 'p-empty' } },
        { type: 'paragraph', attrs: { uid: 'p-beta' }, content: [{ type: 'text', text: 'beta' }] },
      ],
    },
  })

  it('a pasted EMPTY block collides like any other node — no split-branch escape', () => {
    const { editor, api } = renderEditor([], { content: threeWithEmpty() })
    const clipboard = editor.state.doc.toJSON().content
    editor.commands.insertContentAt(editor.state.doc.content.size, clipboard)

    const ids = collectNodeIds(api.getJSON().doc)
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6) // the empty copy re-minted too
    expect(ids.slice(0, 3)).toEqual(['p-alpha', 'p-empty', 'p-beta']) // sources untouched
  })

  it('the empty-block run pasted ABOVE its source — copies re-mint, survivors keep', () => {
    const { editor, api } = renderEditor([], { content: threeWithEmpty() })
    const clipboard = editor.state.doc.toJSON().content
    editor.commands.insertContentAt(0, clipboard)

    const ids = collectNodeIds(api.getJSON().doc)
    expect(new Set(ids).size).toBe(6)
    expect(ids.slice(3)).toEqual(['p-alpha', 'p-empty', 'p-beta']) // document order did not win
  })

  it('a duplicated LEAF (hardBreak) re-mints — content.size 0 alone is not a split shape', () => {
    const withBreak: DocumentJSON = {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { uid: 'p-1' },
            content: [
              { type: 'text', text: 'x' },
              { type: 'hardBreak', attrs: { uid: 'br-1' } },
              { type: 'text', text: 'y' },
            ],
          },
          { type: 'paragraph', attrs: { uid: 'p-2' }, content: [{ type: 'text', text: 'z' }] },
        ],
      },
    }
    const { editor, api } = renderEditor([], { content: withBreak })
    const clipboard = editor.state.doc.toJSON().content
    editor.commands.insertContentAt(editor.state.doc.content.size, clipboard)

    const ids = collectNodeIds(api.getJSON().doc)
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6) // the copied hardBreak re-minted
    expect(ids.slice(0, 3)).toEqual(['p-1', 'br-1', 'p-2'])
  })

  it('REAL pipeline — a pasted run with an empty middle block never duplicates a uid', () => {
    const { editor, api } = renderEditor([], { content: threeWithEmpty() })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    const pasteEvent = new Event('paste') as ClipboardEvent // jsdom has no ClipboardEvent
    editor.view.pasteHTML(
      '<p data-uid="p-alpha">alpha</p><p data-uid="p-empty"></p><p data-uid="p-beta">beta</p>',
      pasteEvent,
    )

    const ids = collectNodeIds(api.getJSON().doc)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id === 'p-empty')).toHaveLength(1)
    expect(ids.slice(0, 3)).toEqual(['p-alpha', 'p-empty', 'p-beta'])
  })
})
