import { describe, expect, it } from 'vitest'
import { docWith, jsonHasNode, renderEditor } from '../test/editorHarness'
import {
  CodeBlockFeature,
  DividerFeature,
  ImageFeature,
  LinkFeature,
  QuoteFeature,
  TableFeature,
} from './index'

describe('insert actions (real editor)', () => {
  it('inserts a table', () => {
    const { api } = renderEditor([TableFeature], { content: docWith('x') })
    expect(api.exec('table.insert')).toBe(true)
    expect(jsonHasNode(api.getJSON().doc, 'table')).toBe(true)
  })

  it('toggles a blockquote', () => {
    const { editor, api } = renderEditor([QuoteFeature], { content: docWith('x') })
    expect(editor.isActive('blockquote')).toBe(false)
    api.exec('quote.toggle')
    expect(editor.isActive('blockquote')).toBe(true)
  })

  it('toggles a code block', () => {
    const { editor, api } = renderEditor([CodeBlockFeature], { content: docWith('x') })
    api.exec('codeBlock.toggle')
    expect(editor.isActive('codeBlock')).toBe(true)
  })

  it('inserts a horizontal rule', () => {
    const { api } = renderEditor([DividerFeature], { content: docWith('x') })
    api.exec('divider.insert')
    expect(jsonHasNode(api.getJSON().doc, 'horizontalRule')).toBe(true)
  })

  it('inserts an image from the payload src', () => {
    const { api } = renderEditor([ImageFeature], { content: docWith('x') })
    api.exec('image.insert', 'https://example.com/a.png')
    expect(jsonHasNode(api.getJSON().doc, 'image')).toBe(true)
  })

  it('inserts a link with the given text and href', () => {
    const { api } = renderEditor([LinkFeature], {
      content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
    })
    expect(api.exec('link.insert', { text: 'Google', href: 'https://google.com' })).toBe(true)

    const html = api.getHTML()
    expect(html).toContain('href="https://google.com"')
    expect(html).toContain('Google')
  })

  it('does not keep the link active after inserting (next text is not linked)', () => {
    const { editor, api } = renderEditor([LinkFeature], {
      content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
    })
    api.exec('link.insert', { text: 'Google', href: 'https://google.com' })

    // Cursor sits right after the inserted link — it must NOT be in link mode.
    expect(editor.isActive('link')).toBe(false)
  })

  it('makes the link mark non-inclusive globally (typing after a link never extends it)', () => {
    const { editor } = renderEditor([LinkFeature], { content: docWith('x') })
    expect(editor.schema.marks.link.spec.inclusive).toBe(false)
  })
})
