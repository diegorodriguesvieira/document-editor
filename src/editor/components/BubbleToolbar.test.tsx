import { render } from '@testing-library/react'
import { NodeSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { MergeFieldFeature, TableFeature } from '../../features'
import { BubbleToolbar, bubbleShouldShow } from './BubbleToolbar'
import { defineFeature } from '../core/defineFeature'
import { docWith, renderEditor } from '../../test/editorHarness'

const bold = defineFeature({
  id: 'bold',
  extensions: () => [],
  commands: { 'bold.toggle': () => true },
  bubble: [{ id: 'bold', group: 'marks', label: 'Bold', commandId: 'bold.toggle' }],
})

describe('<BubbleToolbar />', () => {
  it('renders nothing when there is no editor', () => {
    const { api, resolved } = renderEditor([bold])
    const { container } = render(<BubbleToolbar editor={null} api={api} resolved={resolved} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mounts against a real editor without throwing', () => {
    const { editor, api, resolved } = renderEditor([bold])
    expect(() =>
      render(<BubbleToolbar editor={editor} api={api} resolved={resolved} />),
    ).not.toThrow()
  })

  it('renders nothing when NO feature contributes bubble items (no empty dark pill)', () => {
    // TableFeature ships commands/inserts/contextMenu — but zero bubble items.
    const { editor, api, resolved } = renderEditor([TableFeature])
    const { container } = render(<BubbleToolbar editor={editor} api={api} resolved={resolved} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the consumer filter leaves no items', () => {
    const { editor, api, resolved } = renderEditor([bold])
    const { container } = render(
      <BubbleToolbar editor={editor} api={api} resolved={resolved} filter={() => false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('bubbleShouldShow (the presentation contract)', () => {
  it('shows over a real TEXT selection only', () => {
    const { editor } = renderEditor([bold], { content: docWith('hello world') })
    editor.commands.setTextSelection(3) // caret — nothing selected
    expect(bubbleShouldShow(editor)).toBe(false)

    editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(bubbleShouldShow(editor)).toBe(true)
  })

  it('never shows on a select-all over an EMPTY document (a selection of nothing)', () => {
    const { editor } = renderEditor([bold])
    editor.commands.selectAll() // technically non-empty: the empty paragraph
    expect(editor.state.selection.empty).toBe(false)
    expect(bubbleShouldShow(editor)).toBe(false)
  })

  it('never shows over a NODE selection — selected blocks get their own chrome', () => {
    const { editor } = renderEditor([bold], { content: docWith('hello') })
    editor.commands.setNodeSelection(0) // the paragraph node itself
    expect(bubbleShouldShow(editor)).toBe(false)
  })

  it('never shows when the editor is not editable', () => {
    const { editor } = renderEditor([bold], { content: docWith('hello') })
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.setEditable(false)
    expect(bubbleShouldShow(editor)).toBe(false)
  })

  it('never shows over a TEXT selection that is just an atomic chip (a merge-field drop, not a manual node pick)', () => {
    // ProseMirror's own default drop handling (input.ts's `handleDrop`) opens
    // externally-sourced HTML slices as wide as it can, which skips the
    // NodeSelection branch and leaves a lone dropped atom TEXT-selected
    // instead — reproduced here directly via setTextSelection rather than a
    // real drag event.
    const created = renderEditor([bold, MergeFieldFeature], { content: docWith('hello') })
    const { editor, api } = created
    editor.commands.setTextSelection(6) // caret at the end of "hello"
    expect(api.exec('mergeField.insert', { id: 'client.name', label: 'Client name' })).toBe(true)

    let chipPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'mergeField') chipPos = pos
    })
    expect(chipPos).toBeGreaterThanOrEqual(0)
    const chipEnd = chipPos + editor.state.doc.nodeAt(chipPos)!.nodeSize

    editor.commands.setTextSelection({ from: chipPos, to: chipEnd })
    expect(editor.state.selection.empty).toBe(false)
    expect(editor.state.selection instanceof NodeSelection).toBe(false) // a plain TEXT selection
    expect(bubbleShouldShow(editor)).toBe(false)

    // Whitespace riding along with the chip (e.g. the trailing space an
    // insert/drop adds) doesn't rescue the bubble either.
    editor.commands.setTextSelection({ from: chipPos, to: chipEnd + 1 })
    expect(bubbleShouldShow(editor)).toBe(false)

    // But real adjacent text keeps the bubble legitimate — formatting
    // "hello" must still work even with a chip sitting right next to it.
    editor.commands.setTextSelection({ from: 1, to: chipEnd })
    expect(bubbleShouldShow(editor)).toBe(true)
  })
})
