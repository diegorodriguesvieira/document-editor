import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ImageFeature } from '../../features'
import { NodeBubbleBar, NodeBubbleToolbar, nodeBubbleShouldShow } from './NodeBubbleToolbar'
import { createMockEditor } from '../core/createMockEditor'
import { defineFeature } from '../core/defineFeature'
import { resolveFeatures } from '../core/registry'
import { docWith, renderEditor } from '../../test/editorHarness'

const bold = defineFeature({
  id: 'bold',
  extensions: () => [],
  commands: { 'bold.toggle': () => true },
  bubble: [{ id: 'bold', label: 'Bold', commandId: 'bold.toggle' }],
})

/** An editor whose first node is an image (plus a paragraph to park text
 *  selections in). */
const withImage = () =>
  renderEditor([ImageFeature], {
    content: {
      doc: {
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: 'https://example.com/a.png' } },
          { type: 'paragraph' },
        ],
      },
    },
  })

describe('<NodeBubbleToolbar />', () => {
  it('renders nothing when there is no editor', () => {
    const { api, resolved } = renderEditor([ImageFeature])
    const { container } = render(<NodeBubbleToolbar editor={null} api={api} resolved={resolved} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when NO feature contributes nodeBubble sections (no empty dark pill)', () => {
    // `bold` ships commands/bubble — but zero nodeBubble sections.
    const { editor, api, resolved } = renderEditor([bold])
    const { container } = render(<NodeBubbleToolbar editor={editor} api={api} resolved={resolved} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mounts against a real editor without throwing', () => {
    const { editor, api, resolved } = withImage()
    expect(() =>
      render(<NodeBubbleToolbar editor={editor} api={api} resolved={resolved} />),
    ).not.toThrow()
  })
})

describe('nodeBubbleShouldShow (the presentation contract)', () => {
  it('shows over a NODE selection some section claims — the exact selection the text bubble refuses', () => {
    const { editor, api, resolved } = withImage()

    editor.commands.setTextSelection(3) // caret in the paragraph
    expect(nodeBubbleShouldShow(editor, api, resolved.nodeBubble)).toBe(false)

    editor.commands.setNodeSelection(0) // the image node
    expect(nodeBubbleShouldShow(editor, api, resolved.nodeBubble)).toBe(true)
  })

  it('never shows on a node selection NO section claims', () => {
    const { editor, api, resolved } = renderEditor([ImageFeature], {
      content: docWith('hello'),
    })
    editor.commands.setNodeSelection(0) // the paragraph node — not an image
    expect(nodeBubbleShouldShow(editor, api, resolved.nodeBubble)).toBe(false)
  })

  it('never shows when the editor is not editable (read-only chrome must not mutate)', () => {
    const { editor, api, resolved } = withImage()
    editor.commands.setNodeSelection(0)
    editor.setEditable(false)
    expect(nodeBubbleShouldShow(editor, api, resolved.nodeBubble)).toBe(false)
  })
})

describe('node bubble wiring with createMockEditor (the mock seam)', () => {
  it('renders the matched section, dispatches commands, and empties when the section unmatches', async () => {
    const mock = createMockEditor({ active: ['image'] })
    const resolved = resolveFeatures([ImageFeature])

    render(<NodeBubbleBar editor={null} api={mock.api} resolved={resolved} />)

    expect(screen.getByRole('button', { name: 'Align left' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Align center' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Align right' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Align center' }))
    expect(mock.execCalls.map((call) => call.commandId)).toContain('image.alignCenter')

    // Selection moves off the image → the section unmatches → no buttons.
    act(() => {
      mock.setActive([])
    })
    expect(screen.queryByRole('button', { name: 'Align center' })).not.toBeInTheDocument()
  })

  it('active states track ATTRIBUTE-qualified entries — left is "image with neither explicit alignment"', () => {
    const mock = createMockEditor({ active: [{ name: 'image', attrs: { align: 'center' } }] })
    const resolved = resolveFeatures([ImageFeature])
    render(<NodeBubbleBar editor={null} api={mock.api} resolved={resolved} />)

    const pressed = (name: string) =>
      screen.getByRole('button', { name })!.getAttribute('aria-pressed')
    expect(pressed('Align center')).toBe('true')
    expect(pressed('Align left')).toBe('false')
    expect(pressed('Align right')).toBe('false')

    // No attrs = the canonical-null left alignment.
    act(() => {
      mock.setActive(['image'])
    })
    expect(pressed('Align left')).toBe('true')
    expect(pressed('Align center')).toBe('false')

    act(() => {
      mock.setActive([{ name: 'image', attrs: { align: 'right' } }])
    })
    expect(pressed('Align right')).toBe('true')
    expect(pressed('Align left')).toBe('false')
  })
})
