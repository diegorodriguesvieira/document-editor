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
 * Transaction meta stamped by {@link EditorApi.setJSON} on the transaction
 * that swaps the whole document. Consumers keying external state on node uids
 * (the comments segments plugin) treat it as "everything you mapped is stale —
 * re-seed from your source of truth". It must ride the SAME transaction as the
 * content swap so no half-mapped state survives in between; `editor.chain()`
 * guarantees that — every chained command mutates ONE shared transaction that
 * `run()` dispatches once (@tiptap/core dist, createChain: `const tr = startTr
 * || state.tr` feeds every command's props, then `view.dispatch(tr)`).
 */
export const DOCUMENT_REPLACED_META = 'documentReplaced'

/**
 * The stable facade the app talks to instead of the raw TipTap `Editor`.
 * Light by design (engine-swap is hygiene, not a real requirement) — its job
 * is to keep `@tiptap/*` out of product code, not to make the engine swappable.
 */
export interface EditorApi extends EditorStateView {
  getJSON(): DocumentJSON
  /** Replace the whole document — a heavy O(n) load (full reparse), not an
   *  update channel. Content is uid-stamped on the way in (missing node ids
   *  minted, duplicates re-minted). The swap transaction carries
   *  {@link DOCUMENT_REPLACED_META} so external-anchor consumers (comments)
   *  re-seed in the same transaction. Throws if `doc` contains content
   *  invalid for the active schema (e.g. a node whose feature is disabled). */
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

/**
 * The scroll behind {@link EditorApi.scrollTo}, callable with a bare editor —
 * SDK feature UI holding an `Editor` but no api instance (the comments panel's
 * jump) shares the one implementation instead of re-rolling the workaround.
 *
 * DOM scroll, NOT a dispatch with PM's scrollIntoView: prosemirror-view bails
 * out of scrollToSelection while the DOM focus sits outside the view — and it
 * does in the case this exists for, the user just clicked a panel. (Same trap
 * the comments panel hit.) Optional-chained: jsdom has no scrollIntoView.
 */
export function scrollEditorTo(editor: Editor, pos: number): void {
  const clamped = Math.max(0, Math.min(pos, editor.state.doc.content.size))
  const dom = editor.view.nodeDOM(clamped) ?? editor.view.domAtPos(clamped).node
  const el = dom instanceof Element ? dom : dom.parentElement
  el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
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
    scrollTo: (pos) => scrollEditorTo(editor, pos),
    getJSON: () => toDocumentJSON(editor),
    setJSON: (doc) => {
      // One transaction: the meta and the replaceWith ride together (chained
      // commands share a single tr — see DOCUMENT_REPLACED_META). setContent
      // still throws synchronously on invalid content inside run().
      editor
        .chain()
        .setMeta(DOCUMENT_REPLACED_META, true)
        .setContent(injectNodeIds(doc).doc)
        .run()
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
