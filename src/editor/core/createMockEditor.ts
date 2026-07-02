import { createEmptyDocument, type DocumentJSON } from './document'
import type { EditorApi } from './EditorApi'

export interface MockEditorInit {
  /** Mark/node names that should report active (matched by name; attrs ignored). */
  active?: string[]
  doc?: DocumentJSON
  canUndo?: boolean
  canRedo?: boolean
  isEmpty?: boolean
  /** Whether the selection is a caret (default true — a fresh editor's state). */
  isSelectionEmpty?: boolean
}

export interface MockEditor {
  /** A drop-in `EditorApi` backed by in-memory state — no real TipTap editor. */
  api: EditorApi
  /** Every `api.exec` call, in order, for assertions. */
  execCalls: Array<{ commandId: string; payload?: unknown }>
  /** Replace the active set and notify subscribers (selection change). */
  setActive(names: string[]): void
  emitUpdate(): void
  emitSelection(): void
}

/**
 * The analog of the Deel doc's `createMockEngine`: an in-memory `EditorApi`
 * for testing toolbars, custom buttons and command wiring with no jsdom editor,
 * no ProseMirror, and no `.focus()` quirks. Render `<EditorToolbar editor={null}
 * api={mock.api} resolved={...} />` and assert against `mock.execCalls` /
 * `mock.setActive([...])`.
 */
export function createMockEditor(init: MockEditorInit = {}): MockEditor {
  let active = new Set(init.active ?? [])
  let doc = init.doc ?? createEmptyDocument()
  const execCalls: Array<{ commandId: string; payload?: unknown }> = []
  const listeners: Record<'update' | 'selection', Set<() => void>> = {
    update: new Set(),
    selection: new Set(),
  }
  const emit = (event: 'update' | 'selection') => {
    for (const cb of [...listeners[event]]) cb()
  }

  const api: EditorApi = {
    isActive: (name) => active.has(name),
    canUndo: () => init.canUndo ?? false,
    canRedo: () => init.canRedo ?? false,
    isEmpty: () => init.isEmpty ?? false,
    isSelectionEmpty: () => init.isSelectionEmpty ?? true,
    hasNode: (name) => (doc.doc.content ?? []).some((node) => node.type === name),
    getJSON: () => doc,
    setJSON: (next) => {
      doc = next
      emit('update')
    },
    getHTML: () => '',
    focus: () => {},
    exec: (commandId, payload) => {
      execCalls.push({ commandId, payload })
      emit('update')
      return true
    },
    on: (event, callback) => {
      listeners[event].add(callback)
      return () => listeners[event].delete(callback)
    },
  }

  return {
    api,
    execCalls,
    setActive: (names) => {
      active = new Set(names)
      emit('selection')
    },
    emitUpdate: () => emit('update'),
    emitSelection: () => emit('selection'),
  }
}
