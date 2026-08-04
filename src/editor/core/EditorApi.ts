import type { Editor } from '@tiptap/core'
import { hasTopLevelNode, isBlankDocument, toDocumentJSON, type DocumentJSON } from './document'
import { injectNodeIds } from './nodeIds'
import type { ResolvedFeatures } from './registry'

/**
 * The slice of editor state the toolbar reads. Both the real `EditorApi` and
 * the in-memory `createMockEditor` implement it — that seam is what makes the
 * toolbar and feature wiring testable without a real TipTap editor.
 */
export interface EditorStateView {
  isActive(name: string, attrs?: Record<string, unknown>): boolean
  /** Whether there is history to undo / redo (drives a real disabled state). */
  canUndo(): boolean
  canRedo(): boolean
  /** Whether the document is still the BLANK initial document (one empty
   *  paragraph). Structure with no text yet — an inserted table, a callout —
   *  already counts as content. */
  isEmpty(): boolean
  /** Whether the selection is a caret (nothing selected) — lets a toolbar item
   *  declare `isDisabled: (s) => s.isSelectionEmpty()` for selection-dependent
   *  actions (link, comment…) without reaching for the raw editor. */
  isSelectionEmpty(): boolean
}

/** One `findNodes` match: where the node sits — a `scrollTo` handle, valid
 *  until the next edit — plus its attributes (a variable chip's id/label…). */
export interface FoundNode {
  pos: number
  attrs: Record<string, unknown>
}

/**
 * The stable facade the app talks to instead of the raw TipTap `Editor`.
 * Light by design (engine-swap is hygiene, not a real requirement) — its job
 * is to keep `@tiptap/*` out of product code, not to make the engine swappable.
 */
export interface EditorApi extends EditorStateView {
  getJSON(): DocumentJSON
  /** Replace the whole document — a heavy O(n) load (full reparse), not an
   *  update channel. Content is uid-stamped on the way in (missing node ids
   *  minted, duplicates re-minted). Throws if `doc` contains content invalid
   *  for the active schema (e.g. a node whose feature is disabled). */
  setJSON(doc: DocumentJSON): void
  getHTML(): string
  /** Whether a top-level node of this type exists in the document. */
  hasNode(name: string): boolean
  /** Every node of this type anywhere in the document, in document order,
   *  each with the position `scrollTo` takes. Positions shift with every
   *  edit — derive them fresh (`useFeatureState(editor, () =>
   *  api.findNodes('variable'))`), don't store them. */
  findNodes(name: string): FoundNode[]
  /** Bring the content at `pos` into view (smooth, centered), e.g. a
   *  `findNodes` hit from an outline/variables panel. Scrolling only — the
   *  selection and focus stay where they are. */
  scrollTo(pos: number): void
  /** Return focus to the editor (e.g. after a modal/popover closes). */
  focus(): void
  exec(commandId: string, payload?: unknown): boolean
  on(event: 'update' | 'selection', callback: () => void): () => void
}

export function createEditorApi(editor: Editor, resolved: ResolvedFeatures): EditorApi {
  return {
    isActive: (name, attrs) => editor.isActive(name, attrs),
    canUndo: () => editor.can().undo?.() ?? false,
    canRedo: () => editor.can().redo?.() ?? false,
    isEmpty: () => isBlankDocument(editor.state.doc),
    isSelectionEmpty: () => editor.state.selection.empty,
    hasNode: (name) => hasTopLevelNode(editor.state.doc, name),
    findNodes: (name) => {
      const found: FoundNode[] = []
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === name) found.push({ pos, attrs: node.attrs })
      })
      return found
    },
    scrollTo: (pos) => {
      const clamped = Math.max(0, Math.min(pos, editor.state.doc.content.size))
      // DOM scroll, NOT a dispatch with PM's scrollIntoView: prosemirror-view
      // bails out of scrollToSelection while the DOM focus sits outside the
      // view — and it does in the case this API exists for, the user just
      // clicked a panel. (Same trap the comments panel hit.) Optional-chained:
      // jsdom has no scrollIntoView.
      const dom = editor.view.nodeDOM(clamped) ?? editor.view.domAtPos(clamped).node
      const el = dom instanceof Element ? dom : dom.parentElement
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    },
    getJSON: () => toDocumentJSON(editor),
    setJSON: (doc) => {
      editor.commands.setContent(injectNodeIds(doc).doc)
    },
    getHTML: () => editor.getHTML(),
    focus: () => {
      editor.commands.focus()
    },
    exec: (commandId, payload) => {
      const command = resolved.commands[commandId]
      // Unregistered id = a typo or a command outside this preset. The boot
      // check can't see dynamic exec() calls (custom `render` controls build
      // ids at runtime) — throwing keeps the "no silent no-op" promise;
      // `false` stays reserved for "registered but didn't apply".
      if (!command) {
        throw new Error(`Command "${commandId}" is not registered by any enabled feature.`)
      }
      return command(editor, payload)
    },
    on: (event, callback) => {
      const name = event === 'selection' ? 'selectionUpdate' : 'update'
      editor.on(name, callback)
      return () => editor.off(name, callback)
    },
  }
}
