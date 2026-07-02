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
