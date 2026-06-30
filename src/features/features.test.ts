import { afterEach, describe, expect, it } from 'vitest'
import { createEditor, type CreatedEditor } from '../editor'
import { BoldFeature, HeadingFeature, ListsFeature } from './index'

let created: CreatedEditor | undefined

afterEach(() => {
  created?.editor.destroy()
  created = undefined
})

const docWith = (text: string) => ({
  schemaVersion: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})

// Commands chain `.focus()`, which only applies on a mounted editor view.
function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('platform features', () => {
  it('compose into the editor and their commands actually apply', () => {
    created = createEditor({
      features: [BoldFeature, HeadingFeature],
      element: mountTarget(),
      content: docWith('hi'),
    })
    const { editor, api } = created

    editor.commands.selectAll()
    expect(editor.isActive('bold')).toBe(false)

    expect(api.exec('bold.toggle')).toBe(true)
    expect(editor.isActive('bold')).toBe(true)
  })

  it('only contributes toolbar items for the features that were opted in', () => {
    const withLists = createEditor({ features: [BoldFeature, ListsFeature] })
    expect(withLists.resolved.toolbar.map((t) => t.id)).toEqual(
      expect.arrayContaining(['bold', 'bulletList', 'orderedList']),
    )
    withLists.editor.destroy()

    const boldOnly = createEditor({ features: [BoldFeature] })
    expect(boldOnly.resolved.toolbar.map((t) => t.id)).not.toContain('bulletList')
    boldOnly.editor.destroy()
  })

  it('exec returns false for a command no enabled feature provides', () => {
    created = createEditor({ features: [BoldFeature] })
    expect(created.api.exec('lists.bullet')).toBe(false)
  })
})
