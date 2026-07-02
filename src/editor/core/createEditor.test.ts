import { describe, expect, it, vi } from 'vitest'
import { renderEditor } from '../../test/editorHarness'
import { BoldFeature } from '../../features'

// A `callout` node, but the callout feature is NOT enabled → unknown to the schema.
const docWithUnknownNode = {
  doc: { type: 'doc', content: [{ type: 'callout', content: [{ type: 'paragraph' }] }] },
}

describe('content validation (enableContentCheck)', () => {
  it('throws on setJSON of invalid content instead of silently wiping the doc', () => {
    const { api } = renderEditor([BoldFeature])
    expect(() => api.setJSON(docWithUnknownNode)).toThrow()
  })

  it('routes invalid initial content to onContentError (graceful) when provided', () => {
    const onContentError = vi.fn()
    expect(() => {
      renderEditor([BoldFeature], { content: docWithUnknownNode, onContentError })
    }).not.toThrow()
    expect(onContentError).toHaveBeenCalledTimes(1)
  })
})
