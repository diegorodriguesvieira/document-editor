import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { renderEditor } from '../../test/editorHarness'
import { QuoteFeature } from '../blocks/blockquote'
import { VariableFeature } from './variable'
import { COMMENT_ANCHOR_GOLDEN_VECTORS } from './commentAnchor.golden'
import {
  resolveSegment,
  segmentsFromRange,
  textForSegments,
} from './commentAnchor'

/** A real schema (kernel + chip + blockquote) to hydrate fixture JSON against
 *  — the pure helpers take PM nodes, no editor dispatch involved. */
function pmDoc(json: JSONContent): PMNode {
  const { editor } = renderEditor([VariableFeature, QuoteFeature])
  return editor.schema.nodeFromJSON(json)
}

const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks })
const paragraph = (uid: string | null, text: string): JSONContent => ({
  type: 'paragraph',
  ...(uid == null ? {} : { attrs: { uid } }),
  content: [{ type: 'text', text }],
})

describe('golden vectors — the shared FE/BE offset contract', () => {
  for (const vector of COMMENT_ANCHOR_GOLDEN_VECTORS) {
    it(vector.name, () => {
      const document = pmDoc(vector.doc)
      const resolved = resolveSegment(document, vector.segment)
      if (vector.text === null) {
        expect(resolved).toBeNull()
        // Unresolvable segments quote nothing — never throw, never guess.
        expect(textForSegments(document, [vector.segment])).toBe('')
      } else {
        expect(resolved).not.toBeNull()
        expect(textForSegments(document, [vector.segment])).toBe(vector.text)
      }
    })
  }

  it('concatenates multiple segments in ARRAY order (the quote rule)', () => {
    const document = pmDoc(
      doc(paragraph('p1', 'alpha'), paragraph('p2', 'beta')),
    )
    const segments = [
      { id: 'p2', from: 0, to: 4 },
      { id: 'p1', from: 0, to: 5 },
    ]
    // Array order, not document order — the stored order IS the quote order.
    expect(textForSegments(document, segments)).toBe('betaalpha')
  })
})

describe('segmentsFromRange — canonical nodes[] derivation', () => {
  it('derives a single clipped segment inside one block', () => {
    const document = pmDoc(doc(paragraph('p1', 'hello world')))
    // Absolute (3, 9) → local (2, 8): "llo wo".
    expect(segmentsFromRange(document, 3, 9)).toEqual([{ id: 'p1', from: 2, to: 8 }])
  })

  it('splits a cross-block range into per-block segments, document order', () => {
    const document = pmDoc(doc(paragraph('p1', 'alpha'), paragraph('p2', 'beta')))
    // p1 content is [1..6], p2 content is [8..12]; (3, 10) covers both tails.
    expect(segmentsFromRange(document, 3, 10)).toEqual([
      { id: 'p1', from: 2, to: 5 },
      { id: 'p2', from: 0, to: 2 },
    ])
  })

  it('descends through a blockquote — the wrapper contributes NO segment', () => {
    const document = pmDoc(
      doc(paragraph('p0', 'lead'), {
        type: 'blockquote',
        attrs: { uid: 'bq' },
        content: [paragraph('p-in', 'quoted')],
      }),
    )
    // p0 [0..6], blockquote opens at 6, inner paragraph content is [8..14].
    const segments = segmentsFromRange(document, 3, 12)
    expect(segments).toEqual([
      { id: 'p0', from: 2, to: 4 },
      { id: 'p-in', from: 0, to: 4 },
    ])
    expect(segments.map((segment) => segment.id)).not.toContain('bq')
  })

  it('emits a segment for an atom-only span (chip counts 1)', () => {
    const document = pmDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { uid: 'p-chip' },
          content: [
            { type: 'text', text: 'ab ' },
            { type: 'variable', attrs: { id: 'client.name', label: 'Client name' } },
            { type: 'text', text: ' cd' },
          ],
        },
      ],
    })
    // The chip sits at content offset 3..4 → absolute (4, 5).
    expect(segmentsFromRange(document, 4, 5)).toEqual([{ id: 'p-chip', from: 3, to: 4 }])
  })

  it('emits nothing for a range covering only block boundary tokens', () => {
    const document = pmDoc(doc(paragraph('p1', 'alpha'), paragraph('p2', 'beta')))
    // (6, 8) is exactly p1's closing token + p2's opening token: no content.
    expect(segmentsFromRange(document, 6, 8)).toEqual([])
  })

  it('skips textblocks without a uid — defensive, never a corrupt segment', () => {
    // nodeFromJSON does not run entry injection, so an unstamped block is
    // constructible here even though editors never hold one.
    const document = pmDoc(doc(paragraph(null, 'bare'), paragraph('p2', 'beta')))
    expect(segmentsFromRange(document, 1, 12)).toEqual([{ id: 'p2', from: 0, to: 4 }])
  })
})

