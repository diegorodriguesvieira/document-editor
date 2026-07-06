import { describe, expect, it } from 'vitest'
import { DecorationSet } from '@tiptap/pm/view'
import { docWith, jsonFindNode, renderEditor } from '../../test/editorHarness'
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

  it('registers its Mod-Shift-e shortcut in the resolved keymap', () => {
    const { resolved } = renderEditor([CalloutFeature])
    expect(resolved.keymap['Mod-Shift-e']).toBe('callout.toggle')
  })

  it('updates the emoji chrome IN PLACE when the attr changes (pure-DOM update path)', () => {
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
    const emoji = editor.view.dom.querySelector('.callout__emoji') as HTMLElement

    editor.commands.setTextSelection(2) // caret inside the callout
    editor.commands.updateAttributes('callout', { emoji: '🔥' })

    // Same element mutated — update() returned true, no remount.
    expect(editor.view.dom.querySelector('.callout__emoji')).toBe(emoji)
    expect(emoji.textContent).toBe('🔥')

    // And the view refuses a node that is not a callout (PM falls back to a
    // fresh node view on replace).
    const construct = editor.view.someProp('nodeViews')?.callout
    const detached = construct!(editor.state.doc.firstChild!, editor.view, () => 0, [], DecorationSet.empty)
    const paragraph = editor.state.doc.lastChild! // the trailing paragraph
    expect(detached.update!(paragraph, [], DecorationSet.empty)).toBe(false)
    detached.destroy?.()
  })

  it('parses pasted HTML with a data-emoji — and falls back to the default without one', () => {
    const created = renderEditor([CalloutFeature])
    created.editor.commands.insertContent('<div data-type="callout" data-emoji="🚀"><p>x</p></div>')
    expect(jsonFindNode(created.api.getJSON().doc, 'callout')?.attrs?.emoji).toBe('🚀')

    const bare = renderEditor([CalloutFeature])
    bare.editor.commands.insertContent('<div data-type="callout"><p>y</p></div>')
    expect(jsonFindNode(bare.api.getJSON().doc, 'callout')?.attrs?.emoji).toBe('💡')
  })
})
