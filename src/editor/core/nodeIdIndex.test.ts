import { describe, expect, it } from 'vitest'
import type { Node as PMNode } from '@tiptap/pm/model'
import { nodeIdIndex } from './nodeIdIndex'
import { NODE_ID_ATTRIBUTE } from './nodeIds'
import { TableFeature } from '../../features'
import { renderEditor } from '../../test/editorHarness'

/** A real schema doc built straight from JSON — nodeIdIndex is pure over the
 *  PM node, so no editor state or transactions are involved. */
function pmDoc(json: Record<string, unknown>): PMNode {
  const { editor } = renderEditor([TableFeature])
  return editor.schema.nodeFromJSON(json)
}

const uid = (value: string) => ({ [NODE_ID_ATTRIBUTE]: value })

describe('nodeIdIndex', () => {
  it('walks the whole tree once — first occurrence in document order wins', () => {
    const doc = pmDoc({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: uid('a'), content: [{ type: 'text', text: 'first' }] },
        {
          type: 'table',
          attrs: uid('t'),
          content: [
            {
              type: 'tableRow',
              attrs: uid('r'),
              content: [
                {
                  type: 'tableCell',
                  attrs: uid('c'),
                  // Nested duplicate of 'a' — must be reported, not indexed.
                  content: [{ type: 'paragraph', attrs: uid('a'), content: [{ type: 'text', text: 'nested' }] }],
                },
              ],
            },
          ],
        },
      ],
    })

    const index = nodeIdIndex(doc)
    expect([...index.byId.keys()]).toEqual(['a', 't', 'r', 'c'])
    expect(index.duplicated).toEqual(new Set(['a']))
    const first = index.byId.get('a')
    expect(first?.node.textContent).toBe('first')
    // pos is the position BEFORE the node, as descendants reports it.
    expect(doc.nodeAt(first?.pos ?? -1)).toBe(first?.node)
  })

  it('a uid seen three times still yields ONE byId entry and one duplicated mark', () => {
    const doc = pmDoc({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: uid('dup'), content: [{ type: 'text', text: 'keep' }] },
        { type: 'paragraph', attrs: uid('dup') },
        { type: 'paragraph', attrs: uid('dup') },
      ],
    })

    const index = nodeIdIndex(doc)
    expect(index.byId.size).toBe(1)
    expect(index.byId.get('dup')?.node.textContent).toBe('keep')
    expect(index.duplicated).toEqual(new Set(['dup']))
  })

  it('caches per doc — the same doc returns the same index object', () => {
    const json = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: uid('x') }],
    }
    const doc = pmDoc(json)
    expect(nodeIdIndex(doc)).toBe(nodeIdIndex(doc))

    // A structurally equal but distinct doc gets its own index — identity,
    // not deep equality, is the cache key (PM docs are immutable).
    const twin = pmDoc(json)
    expect(nodeIdIndex(twin)).not.toBe(nodeIdIndex(doc))
    expect(nodeIdIndex(twin).byId.get('x')?.pos).toBe(nodeIdIndex(doc).byId.get('x')?.pos)
  })

  it('skips the doc root, text leaves, and unstamped values', () => {
    const doc = pmDoc({
      type: 'doc',
      content: [
        { type: 'paragraph' }, // uid defaults to null
        { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: '' } }, // garbage — treated as missing
        { type: 'paragraph', attrs: uid('only'), content: [{ type: 'text', text: 'text leaf' }] },
      ],
    })

    const index = nodeIdIndex(doc)
    // Only the stamped paragraph is indexed: no entry for the doc root (never
    // visited by descendants), none for text leaves (out of uid scope), and
    // none for the null/'' placeholders — so broken nodes can never collide.
    expect([...index.byId.keys()]).toEqual(['only'])
    expect(index.duplicated.size).toBe(0)
  })
})
