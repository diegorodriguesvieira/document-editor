import { describe, expect, it } from 'vitest'
import { docWith, renderEditor } from '../test/editorHarness'
import { BoldFeature, HeadingFeature, ItalicFeature, ListsFeature } from './index'

describe('platform features', () => {
  it('compose into the editor and their commands actually apply', () => {
    const { editor, api } = renderEditor([BoldFeature, HeadingFeature], {
      content: docWith('hi'),
    })

    editor.commands.selectAll()
    expect(editor.isActive('bold')).toBe(false)

    expect(api.exec('bold.toggle')).toBe(true)
    expect(editor.isActive('bold')).toBe(true)
  })

  it('only contributes toolbar items for the features that were opted in', () => {
    const withLists = renderEditor([BoldFeature, ListsFeature])
    expect(withLists.resolved.toolbar.map((t) => t.id)).toEqual(
      expect.arrayContaining(['bold', 'bulletList', 'orderedList']),
    )

    const boldOnly = renderEditor([BoldFeature])
    expect(boldOnly.resolved.toolbar.map((t) => t.id)).not.toContain('bulletList')
  })

  it('exec returns false for a command no enabled feature provides', () => {
    const { api } = renderEditor([BoldFeature])
    expect(api.exec('lists.bullet')).toBe(false)
  })

  it('every block/mark command the presets rely on actually applies', () => {
    const { editor, api } = renderEditor([HeadingFeature, ListsFeature, ItalicFeature], {
      content: docWith('texto'),
    })
    // Caret INSIDE the paragraph — node isActive reads the ancestor chain (a
    // select-all would drag the kernel's trailing paragraph into the math).
    editor.commands.setTextSelection(3)

    // Lists first (they wrap the paragraph), toggling between the two kinds.
    expect(api.exec('lists.bullet')).toBe(true)
    expect(editor.isActive('bulletList')).toBe(true)
    expect(api.exec('lists.ordered')).toBe(true)
    expect(editor.isActive('orderedList')).toBe(true)
    expect(editor.isActive('bulletList')).toBe(false)
    expect(api.exec('lists.ordered')).toBe(true) // toggle back off
    expect(editor.isActive('orderedList')).toBe(false)

    // The three heading levels convert into each other.
    for (const level of [1, 2, 3] as const) {
      expect(api.exec(`heading.h${level}`)).toBe(true)
      expect(editor.isActive('heading', { level })).toBe(true)
    }

    editor.commands.setTextSelection({ from: 1, to: 6 }) // "texto"
    expect(api.exec('italic.toggle')).toBe(true)
    expect(editor.isActive('italic')).toBe(true)
  })
})
