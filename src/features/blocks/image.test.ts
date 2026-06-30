import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { createEditor, type CreatedEditor } from '../../editor'
import { ImageFeature } from './image'

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

function hasNode(node: JSONContent, type: string): boolean {
  if (node.type === type) return true
  return node.content?.some((child) => hasNode(child, type)) ?? false
}

describe('image src safety', () => {
  function editor() {
    created = createEditor({ features: [ImageFeature], element: mountTarget() })
    return created
  }

  it('inserts an http(s) image', () => {
    expect(editor().api.exec('image.insert', 'https://example.com/a.png')).toBe(true)
    expect(hasNode(created!.api.getJSON().doc, 'image')).toBe(true)
  })

  it('allows data: URLs', () => {
    expect(editor().api.exec('image.insert', 'data:image/png;base64,iVBOR')).toBe(true)
  })

  it('rejects javascript: and other script protocols', () => {
    expect(editor().api.exec('image.insert', 'javascript:alert(1)')).toBe(false)
    expect(created!.api.exec('image.insert', 'vbscript:msgbox')).toBe(false)
    expect(hasNode(created!.api.getJSON().doc, 'image')).toBe(false)
  })
})
