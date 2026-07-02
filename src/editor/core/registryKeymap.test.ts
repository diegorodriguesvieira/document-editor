import { describe, expect, it } from 'vitest'
import { defineFeature } from '../../editor'
import { renderEditor } from '../../test/editorHarness'

/**
 * The one seam where a feature's `keymap` reaches the engine: buildExtensions'
 * synthetic registryKeymap extension. Everything else about keymaps is data —
 * this proves a real keydown actually dispatches the registered command.
 */
describe('registryKeymap', () => {
  it('routes a real keydown through a feature keymap to its command', () => {
    let ran = 0
    const KeymapProbe = defineFeature({
      id: 'kbd-probe',
      extensions: () => [],
      commands: {
        'probe.run': () => {
          ran += 1
          return true
        },
      },
      keymap: { 'Mod-Shift-Enter': 'probe.run' },
    })
    const { editor } = renderEditor([KeymapProbe])
    editor.commands.focus()

    // Wrong chord: nothing happens.
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }),
    )
    expect(ran).toBe(0)

    // The registered chord (jsdom is non-mac: Mod = Ctrl) dispatches the command.
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(ran).toBe(1)
  })
})
