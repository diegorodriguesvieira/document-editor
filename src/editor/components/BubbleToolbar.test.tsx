import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TableFeature } from '../../features'
import { BubbleToolbar, bubbleShouldShow } from './BubbleToolbar'
import { defineFeature } from '../core/defineFeature'
import { docWith, renderEditor } from '../../test/editorHarness'

const bold = defineFeature({
  id: 'bold',
  extensions: () => [],
  commands: { 'bold.toggle': () => true },
  toolbar: [{ id: 'bold', group: 'marks', label: 'Bold', commandId: 'bold.toggle' }],
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

  it('renders nothing when NO feature contributes toolbar items (no empty dark pill)', () => {
    // TableFeature ships commands/inserts/contextMenu — but zero toolbar items.
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
})
