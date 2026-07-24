import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { defineFeature } from './defineFeature'
import { docWith, renderEditor } from '../../test/editorHarness'
import { BoldFeature, HistoryFeature, TableFeature, VariableFeature } from '../../features'

describe('EditorApi (the facade over a real editor)', () => {
  it('canUndo/canRedo degrade to false — not a crash — when no history feature is enabled', () => {
    const { api } = renderEditor([BoldFeature]) // no UndoRedo extension at all
    expect(api.canUndo()).toBe(false)
    expect(api.canRedo()).toBe(false)
  })

  it('canUndo turns true once there is an edit to rewind (history enabled)', () => {
    const created = renderEditor([HistoryFeature])
    expect(created.api.canUndo()).toBe(false)
    created.editor.commands.insertContent('x')
    expect(created.api.canUndo()).toBe(true)
  })

  it('isEmpty means BLANK document — text ends it, and so does text-less structure', () => {
    const created = renderEditor([TableFeature])
    expect(created.api.isEmpty()).toBe(true)

    created.editor.commands.insertContent('algo')
    expect(created.api.isEmpty()).toBe(false)

    // Structure without a single character is content too: an inserted table
    // is all empty cells, and it must flip isEmpty exactly like text does.
    const withTable = renderEditor([TableFeature])
    withTable.api.exec('table.insert')
    expect(withTable.editor.getText().trim()).toBe('')
    expect(withTable.api.isEmpty()).toBe(false)
  })

  it('focus() delegates to the view (modals hand focus back through the api)', async () => {
    const created = renderEditor([BoldFeature])
    const focus = vi.spyOn(created.editor.view, 'focus')
    created.api.focus()
    // TipTap defers the DOM focus to the next frame.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(focus).toHaveBeenCalled()
  })

  it('on("selection") notifies on selection changes and the unsubscribe really detaches', () => {
    const created = renderEditor([BoldFeature], { content: docWith('hello') })
    const seen = vi.fn()
    const off = created.api.on('selection', seen)

    created.editor.commands.setTextSelection(3)
    expect(seen).toHaveBeenCalled()

    const calls = seen.mock.calls.length
    off()
    created.editor.commands.setTextSelection(4)
    expect(seen.mock.calls.length).toBe(calls)
  })
})

// Two chips (one per paragraph, filler between) — enough to pin document
// order, real positions and attrs pass-through.
const CHIPPED_DOC = {
  doc: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Dear ' },
          { type: 'variable', attrs: { id: 'client.name', label: 'Client name' } },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'filler paragraph' }] },
      {
        type: 'paragraph',
        content: [{ type: 'variable', attrs: { id: 'amount.monthly', label: 'Monthly amount' } }],
      },
    ],
  },
}

/** jsdom has no scrollIntoView — install one and return the spy. */
function stubScrollIntoView() {
  const spy = vi.fn()
  const proto = Element.prototype as unknown as { scrollIntoView?: typeof spy }
  proto.scrollIntoView = spy
  onTestFinished(() => {
    delete proto.scrollIntoView
  })
  return spy
}

describe('findNodes / scrollTo (the outline-panel seam)', () => {
  it('findNodes returns every match in document order, with REAL positions and attrs', () => {
    const { api, editor } = renderEditor([VariableFeature], { content: CHIPPED_DOC })
    const found = api.findNodes('variable')

    expect(found.map((entry) => entry.attrs.id)).toEqual(['client.name', 'amount.monthly'])
    // The positions are live ProseMirror offsets, not indices: the doc
    // resolves each one back to the very node reported.
    for (const entry of found) {
      expect(editor.state.doc.nodeAt(entry.pos)?.type.name).toBe('variable')
    }
    expect(api.findNodes('image')).toEqual([])
  })

  it('scrollTo scrolls the node-view element at pos — DOM-based, so it works while focus sits in a panel', () => {
    const { api } = renderEditor([VariableFeature], { content: CHIPPED_DOC })
    const scrolled = stubScrollIntoView()

    const [chip] = api.findNodes('variable')
    api.scrollTo(chip.pos)

    expect(scrolled).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    const target = scrolled.mock.contexts[0] as Element
    expect(target.getAttribute('data-variable')).toBe('client.name')
  })

  it('scrollTo on a TEXT position scrolls its parent block; out-of-range clamps instead of throwing', () => {
    const { api } = renderEditor([BoldFeature], { content: docWith('hello') })
    const scrolled = stubScrollIntoView()

    api.scrollTo(2) // inside "hello" — a Text DOM node, scroll its <p>
    expect((scrolled.mock.contexts[0] as Element).tagName).toBe('P')

    expect(() => api.scrollTo(9999)).not.toThrow()
    expect(() => api.scrollTo(-5)).not.toThrow()
  })
})

describe('exec fail-fast contract', () => {
  it('THROWS on an unregistered command id — a typo can never silently no-op', () => {
    // Boot validation covers declared channel references; dynamic exec()
    // calls from custom `render` controls are only checkable here. `false`
    // would make a typo indistinguishable from "didn't apply".
    const { api } = renderEditor([BoldFeature])
    expect(() => api.exec('bold.togle')).toThrow(/bold\.togle.*not registered/)
  })

  it('still returns false for a REGISTERED command that did not apply', () => {
    const noop = defineFeature({
      id: 'noop',
      extensions: () => [],
      commands: { 'noop.run': () => false },
    })
    const { api } = renderEditor([noop])
    expect(api.exec('noop.run')).toBe(false)
  })
})
