import { describe, expect, it } from 'vitest'
import { jsonHasNode, renderEditor } from '../../test/editorHarness'
import { ImageFeature } from './image'

describe('image src safety', () => {
  it('inserts an http(s) image', () => {
    const { api } = renderEditor([ImageFeature])
    expect(api.exec('image.insert', 'https://example.com/a.png')).toBe(true)
    expect(jsonHasNode(api.getJSON().doc, 'image')).toBe(true)
  })

  it('allows data: URLs', () => {
    const { api } = renderEditor([ImageFeature])
    expect(api.exec('image.insert', 'data:image/png;base64,iVBOR')).toBe(true)
  })

  it('rejects javascript: and other script protocols', () => {
    const { api } = renderEditor([ImageFeature])
    expect(api.exec('image.insert', 'javascript:alert(1)')).toBe(false)
    expect(api.exec('image.insert', 'vbscript:msgbox')).toBe(false)
    expect(jsonHasNode(api.getJSON().doc, 'image')).toBe(false)
  })
})

describe('image resize (width attribute)', () => {
  it('round-trips width: attr → HTML `width` → parsed back', () => {
    const created = renderEditor([ImageFeature])
    created.api.exec('image.insert', 'https://example.com/a.png')
    created.editor.commands.updateAttributes('image', { width: 400 })

    expect(created.api.getHTML()).toContain('width="400"')

    const reloaded = renderEditor([ImageFeature])
    reloaded.api.setJSON(created.api.getJSON())
    const image = reloaded.api.getJSON().doc.content?.find((node) => node.type === 'image')
    expect(image?.attrs?.width).toBe(400)
  })

  it('parses width from pasted HTML (attribute or inline style)', () => {
    const created = renderEditor([ImageFeature])
    created.editor.commands.insertContent('<img src="https://example.com/a.png" width="300">')
    let image = created.api.getJSON().doc.content?.find((node) => node.type === 'image')
    expect(image?.attrs?.width).toBe(300)

    const other = renderEditor([ImageFeature])
    other.editor.commands.insertContent('<img src="https://example.com/b.png" style="width: 250px">')
    image = other.api.getJSON().doc.content?.find((node) => node.type === 'image')
    expect(image?.attrs?.width).toBe(250)
  })

  it('images without width stay width-less (no serialized attr)', () => {
    const created = renderEditor([ImageFeature])
    created.api.exec('image.insert', 'https://example.com/a.png')
    expect(created.api.getHTML()).not.toContain('width=')
  })

  it('round-trips height (edge-handle stretch persists both dimensions)', () => {
    const created = renderEditor([ImageFeature])
    created.api.exec('image.insert', 'https://example.com/a.png')
    created.editor.commands.updateAttributes('image', { width: 400, height: 250 })

    const html = created.api.getHTML()
    expect(html).toContain('width="400"')
    expect(html).toContain('height="250"')

    const reloaded = renderEditor([ImageFeature])
    reloaded.api.setJSON(created.api.getJSON())
    const image = reloaded.api.getJSON().doc.content?.find((node) => node.type === 'image')
    expect(image?.attrs?.height).toBe(250)
  })
})
