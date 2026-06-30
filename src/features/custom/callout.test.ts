import { afterEach, describe, expect, it } from 'vitest'
import { createEditor, type CreatedEditor } from '../../editor'
import { CalloutFeature } from './callout'

let created: CreatedEditor | undefined

afterEach(() => {
  created?.editor.destroy()
  created = undefined
})

const docWith = (text: string) => ({
  schemaVersion: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})

// The toggle command chains `.focus()`, which needs a mounted editor view.
function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('callout feature', () => {
  it('wraps the current block in a callout via its command', () => {
    created = createEditor({ features: [CalloutFeature], element: mountTarget(), content: docWith('nota') })
    const { editor, api } = created

    expect(editor.isActive('callout')).toBe(false)
    expect(api.exec('callout.toggle')).toBe(true)
    expect(editor.isActive('callout')).toBe(true)
  })

  it('renders the emoji chrome via its pure-DOM node view', () => {
    const target = mountTarget()
    created = createEditor({
      features: [CalloutFeature],
      element: target,
      content: {
        schemaVersion: 1,
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
    expect(target.querySelector('.callout__emoji')?.textContent).toBe('⚠️')
  })

  it('registers its Mod-Shift-c shortcut in the resolved keymap', () => {
    created = createEditor({ features: [CalloutFeature] })
    expect(created.resolved.keymap['Mod-Shift-c']).toBe('callout.toggle')
  })
})
