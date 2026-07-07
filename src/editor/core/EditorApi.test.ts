import { describe, expect, it, vi } from 'vitest'
import { defineFeature } from './defineFeature'
import { docWith, renderEditor } from '../../test/editorHarness'
import { BoldFeature, HistoryFeature, TableFeature } from '../../features'

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
