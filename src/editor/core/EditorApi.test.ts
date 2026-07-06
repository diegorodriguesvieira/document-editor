import { describe, expect, it, vi } from 'vitest'
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
