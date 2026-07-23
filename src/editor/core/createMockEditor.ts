import { createEmptyDocument, type DocumentJSON } from './document'
import type { EditorApi } from './EditorApi'

/** An entry in the mock's active set. A bare name satisfies name-only
 *  `isActive(name)` probes; give `attrs` to satisfy attribute probes too —
 *  matching is TipTap's: the PROBE's attrs must be a subset of the entry's
 *  (so a bare name never matches an attribute probe). */
export type MockActiveEntry = string | { name: string; attrs?: Record<string, unknown> }

export interface MockEditorInit {
  /** Marks/nodes that should report active. */
  active?: MockActiveEntry[]
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
  setActive(entries: MockActiveEntry[]): void
  emitUpdate(): void
  emitSelection(): void
}

function entryMatches(
  entry: MockActiveEntry,
  name: string,
  attrs?: Record<string, unknown>,
): boolean {
  if ((typeof entry === 'string' ? entry : entry.name) !== name) return false
  if (!attrs) return true
  const entryAttrs = typeof entry === 'string' ? undefined : entry.attrs
  return Object.entries(attrs).every(([key, value]) => (entryAttrs ?? {})[key] === value)
}

/**
 * The analog of the Deel doc's `createMockEngine`: an in-memory `EditorApi`
 * for testing bars, custom buttons and command wiring with no jsdom editor,
 * no ProseMirror, and no `.focus()` quirks. Render `<BubbleBar editor={null}
 * api={mock.api} resolved={...} />` and assert against `mock.execCalls` /
 * `mock.setActive([...])`.
 */
export function createMockEditor(init: MockEditorInit = {}): MockEditor {
  let active = init.active ?? []
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
    isActive: (name, attrs) => active.some((entry) => entryMatches(entry, name, attrs)),
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
    setActive: (entries) => {
      active = entries
      emit('selection')
    },
    emitUpdate: () => emit('update'),
    emitSelection: () => emit('selection'),
  }
}
