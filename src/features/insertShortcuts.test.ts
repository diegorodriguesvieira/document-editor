import { describe, expect, it } from 'vitest'
import { resolveFeatures } from '../editor'
import {
  QuoteFeature,
  CodeBlockFeature,
  ConditionalBlockFeature,
  ImageFeature,
  LinkFeature,
  TableFeature,
} from './index'
import { jsonHasNode, renderEditor } from '../test/editorHarness'

/**
 * Dispatch a real chord on the view (commands.keyboardShortcut drops
 * selection changes). Lowercase key: with Shift, prosemirror-keymap matches
 * uppercase via `event.keyCode`, which synthetic events don't carry — real
 * browsers take that path (covered by the browser verification).
 */
function press(view: { dom: HTMLElement }, key: string, shift = true) {
  view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true }),
  )
}

describe('insert shortcuts (the left-rail features)', () => {
  it('declares the product shortcut map, conflict-free', () => {
    const resolved = resolveFeatures([
      TableFeature,
      QuoteFeature,
      CodeBlockFeature,
      LinkFeature,
      ImageFeature,
      ConditionalBlockFeature,
    ])
    expect(resolved.keymap['Mod-Shift-t']).toBe('table.insert')
    expect(resolved.keymap["Mod-Shift-'"]).toBe('quote.toggle')
    expect(resolved.keymap['Mod-"']).toBe('quote.toggle') // layout alias
    expect(resolved.keymap['Mod-Shift-c']).toBe('codeBlock.toggle')
    expect(resolved.keymap['Mod-k']).toBe('link.set')
    expect(resolved.keymap['Mod-Shift-i']).toBe('image.insert')
    expect(resolved.keymap['Mod-Shift-k']).toBe('conditional.wrap')
  })

  it('Mod-Shift-t inserts a table', () => {
    const created = renderEditor([TableFeature])
    created.editor.commands.focus()
    press(created.editor.view, 't')
    expect(jsonHasNode(created.api.getJSON().doc, 'table')).toBe(true)
  })

  it('Mod-Shift-k wraps in a conditional block', () => {
    const created = renderEditor([ConditionalBlockFeature])
    created.editor.commands.focus()
    created.editor.commands.insertContent('cláusula')
    press(created.editor.view, 'k')
    expect(jsonHasNode(created.api.getJSON().doc, 'conditionalBlock')).toBe(true)
  })

  it('Mod-Shift-c toggles a code block', () => {
    const created = renderEditor([CodeBlockFeature])
    created.editor.commands.focus()
    press(created.editor.view, 'c')
    expect(jsonHasNode(created.api.getJSON().doc, 'codeBlock')).toBe(true)
  })
})
