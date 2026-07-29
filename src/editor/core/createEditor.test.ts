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
    // TipTap logs the invalid content before handing it to the callback —
    // expected noise in this test, so capture it instead of polluting stderr.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onContentError = vi.fn()
    expect(() => {
      renderEditor([BoldFeature], { content: docWithUnknownNode, onContentError })
    }).not.toThrow()
    expect(onContentError).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('[tiptap warn]')
    warn.mockRestore()
  })

  it('invalid initial content WITHOUT a handler throws at construction — never a silent wipe', () => {
    expect(() => {
      renderEditor([BoldFeature], { content: docWithUnknownNode })
    }).toThrow()
  })
})

describe('setEditable re-render nudge (baseEditorOptions.onUpdate)', () => {
  it('a direct setEditable dispatches ONE no-op transaction so subscribed UI re-renders', () => {
    const { editor, api } = renderEditor([BoldFeature], { content: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] } } })
    const before = api.getJSON()
    let transactions = 0
    editor.on('transaction', () => {
      transactions += 1
    })

    editor.setEditable(false)
    expect(editor.isEditable).toBe(false)
    // Exactly one nudge — more would mean the handler re-entered itself.
    expect(transactions).toBe(1)
    // The nudge is a NO-OP: the document must be untouched.
    expect(api.getJSON()).toEqual(before)

    editor.setEditable(true)
    expect(transactions).toBe(2)
  })

  it('doc-changing updates do not echo an extra no-op transaction', () => {
    const { editor } = renderEditor([BoldFeature])
    let noOps = 0
    editor.on('transaction', ({ transaction }) => {
      if (!transaction.docChanged) noOps += 1
    })
    editor.commands.insertContent('hello')
    expect(noOps).toBe(0)
  })
})
