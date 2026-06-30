import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { createEditor, type CreatedEditor } from '../editor'
import {
  CodeBlockFeature,
  DividerFeature,
  ImageFeature,
  LinkFeature,
  QuoteFeature,
  TableFeature,
} from './index'

let created: CreatedEditor | undefined

afterEach(() => {
  created?.editor.destroy()
  created = undefined
})

function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

const docWith = (text: string) => ({
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})

function hasNode(node: JSONContent, type: string): boolean {
  if (node.type === type) return true
  return node.content?.some((child) => hasNode(child, type)) ?? false
}

describe('insert actions (real editor)', () => {
  it('inserts a table', () => {
    created = createEditor({ features: [TableFeature], element: mountTarget(), content: docWith('x') })
    expect(created.api.exec('table.insert')).toBe(true)
    expect(hasNode(created.api.getJSON().doc, 'table')).toBe(true)
  })

  it('toggles a blockquote', () => {
    created = createEditor({ features: [QuoteFeature], element: mountTarget(), content: docWith('x') })
    expect(created.editor.isActive('blockquote')).toBe(false)
    created.api.exec('quote.toggle')
    expect(created.editor.isActive('blockquote')).toBe(true)
  })

  it('toggles a code block', () => {
    created = createEditor({ features: [CodeBlockFeature], element: mountTarget(), content: docWith('x') })
    created.api.exec('codeBlock.toggle')
    expect(created.editor.isActive('codeBlock')).toBe(true)
  })

  it('inserts a horizontal rule', () => {
    created = createEditor({ features: [DividerFeature], element: mountTarget(), content: docWith('x') })
    created.api.exec('divider.insert')
    expect(hasNode(created.api.getJSON().doc, 'horizontalRule')).toBe(true)
  })

  it('inserts an image from the payload src', () => {
    created = createEditor({ features: [ImageFeature], element: mountTarget(), content: docWith('x') })
    created.api.exec('image.insert', 'https://example.com/a.png')
    expect(hasNode(created.api.getJSON().doc, 'image')).toBe(true)
  })

  it('inserts a link with the given text and href', () => {
    created = createEditor({
      features: [LinkFeature],
      element: mountTarget(),
      content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
    })
    expect(created.api.exec('link.insert', { text: 'Google', href: 'https://google.com' })).toBe(true)

    const html = created.api.getHTML()
    expect(html).toContain('href="https://google.com"')
    expect(html).toContain('Google')
  })

  it('does not keep the link active after inserting (next text is not linked)', () => {
    created = createEditor({
      features: [LinkFeature],
      element: mountTarget(),
      content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
    })
    created.api.exec('link.insert', { text: 'Google', href: 'https://google.com' })

    // Cursor sits right after the inserted link — it must NOT be in link mode.
    expect(created.editor.isActive('link')).toBe(false)
  })

  it('makes the link mark non-inclusive globally (typing after a link never extends it)', () => {
    created = createEditor({ features: [LinkFeature], element: mountTarget(), content: docWith('x') })
    expect(created.editor.schema.marks.link.spec.inclusive).toBe(false)
  })
})
