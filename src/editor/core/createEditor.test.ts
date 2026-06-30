import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditor, type CreatedEditor } from './createEditor'
import { BoldFeature } from '../../features'

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

// A `callout` node, but the callout feature is NOT enabled → unknown to the schema.
const docWithUnknownNode = {
  schemaVersion: 1,
  doc: { type: 'doc', content: [{ type: 'callout', content: [{ type: 'paragraph' }] }] },
}

describe('content validation (enableContentCheck)', () => {
  it('throws on setJSON of invalid content instead of silently wiping the doc', () => {
    created = createEditor({ features: [BoldFeature], element: mountTarget() })
    expect(() => created!.api.setJSON(docWithUnknownNode)).toThrow()
  })

  it('routes invalid initial content to onContentError (graceful) when provided', () => {
    const onContentError = vi.fn()
    expect(() => {
      created = createEditor({
        features: [BoldFeature],
        element: mountTarget(),
        content: docWithUnknownNode,
        onContentError,
      })
    }).not.toThrow()
    expect(onContentError).toHaveBeenCalledTimes(1)
  })
})
