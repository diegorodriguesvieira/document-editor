import { describe, expect, it } from 'vitest'
import { HeaderFooterFeature } from '../../features/custom/headerFooter'
import { TableFeature } from '../../features/blocks/table'
import type { CreatedEditor } from './createEditor'
import { docWith, renderEditor } from '../../test/editorHarness'

/** Top-level node type names, in order. */
const topLevel = (created: CreatedEditor) =>
  created.editor.state.doc.content.content.map((node) => node.type.name)

/** Select the first occurrence of `text` so a command replaces exactly it. */
function selectText(created: CreatedEditor, text: string) {
  const positions: number[] = []
  created.editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) positions.push(pos)
  })
  created.editor.commands.setTextSelection({ from: positions[0], to: positions[0] + text.length })
}

const regionsDoc = (bodyText: string) => ({
  doc: {
    type: 'doc',
    content: [
      { type: 'documentHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: bodyText }] },
      { type: 'documentFooter', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'F' }] }] },
    ],
  },
})

describe('BodyTrailingNode — always a typeable line below the last body block', () => {
  it('keeps a paragraph after the last block when there is NO footer (stock behavior)', () => {
    const created = renderEditor([TableFeature], { content: docWith('x') })
    selectText(created, 'x')
    // Turning the only paragraph into a table would strand the caret with no
    // block after it — the trailing paragraph keeps a place to type.
    expect(created.api.exec('table.insertColumns', { cols: 2 })).toBe(true)
    expect(topLevel(created)).toEqual(['table', 'paragraph'])
  })

  it('inserts the paragraph ABOVE a footer — where stock TrailingNode never fires', () => {
    const created = renderEditor([TableFeature, HeaderFooterFeature], { content: regionsDoc('hello') })
    selectText(created, 'hello')
    expect(created.api.exec('table.insertColumns', { cols: 2 })).toBe(true)
    // The footer stays last; the new paragraph sits between the table and it,
    // so clicking below the (invisible) columns table lands a real caret.
    expect(topLevel(created)).toEqual(['documentHeader', 'table', 'paragraph', 'documentFooter'])
  })

  it('does not stack extra paragraphs — converges, and only one below the footerless end', () => {
    const created = renderEditor([TableFeature], { content: docWith('x') })
    selectText(created, 'x')
    created.api.exec('table.insertColumns', { cols: 2 })
    // A no-op edit re-runs appendTransaction; it must not append a 2nd paragraph.
    created.editor.commands.setTextSelection(1)
    created.editor.commands.insertContent('y')
    expect(topLevel(created).filter((n) => n === 'paragraph')).toHaveLength(1)
  })
})
