import { describe, expect, it } from 'vitest'
import { docWith, renderEditor } from '../test/editorHarness'
import { BoldFeature, HeadingFeature, ListsFeature } from './index'

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
})
