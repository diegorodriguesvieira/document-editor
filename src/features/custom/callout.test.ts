import { describe, expect, it } from 'vitest'
import { docWith, renderEditor } from '../../test/editorHarness'
import { CalloutFeature } from './callout'

describe('callout feature', () => {
  it('wraps the current block in a callout via its command', () => {
    const { editor, api } = renderEditor([CalloutFeature], { content: docWith('nota') })

    expect(editor.isActive('callout')).toBe(false)
    expect(api.exec('callout.toggle')).toBe(true)
    expect(editor.isActive('callout')).toBe(true)
  })

  it('renders the emoji chrome via its pure-DOM node view', () => {
    const { editor } = renderEditor([CalloutFeature], {
      content: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'callout',
              attrs: { emoji: '⚠️' },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
            },
          ],
        },
      },
    })
    expect(editor.view.dom.querySelector('.callout__emoji')?.textContent).toBe('⚠️')
  })

  it('registers its Mod-Shift-c shortcut in the resolved keymap', () => {
    const { resolved } = renderEditor([CalloutFeature])
    expect(resolved.keymap['Mod-Shift-c']).toBe('callout.toggle')
  })
})
