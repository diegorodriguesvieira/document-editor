import { DOMParser as PMDOMParser, type Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { onTestFinished } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import {
  createEditor,
  type CreateEditorOptions,
  type CreatedEditor,
  type FeatureDefinition,
} from '../editor'

/**
 * Shared real-editor test harness — the supported way to test a feature.
 * Mounts a target in the DOM (commands that chain `.focus()` need a mounted
 * view), creates the editor, and destroys/unmounts it automatically when the
 * test finishes. Returns the same `{ editor, api, resolved }` as createEditor.
 *
 *   const { api, editor } = renderEditor([MyFeature], { content: docWith('x') })
 *
 * For toolbar/command *wiring* you usually don't need this — render the bar
 * against `createMockEditor()` instead (no ProseMirror at all).
 */
export function renderEditor(
  features: FeatureDefinition[],
  options: Omit<CreateEditorOptions, 'features' | 'element'> = {},
): CreatedEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  // Register cleanup BEFORE the risky call, so a throwing createEditor (e.g.
  // invalid initial content) still unmounts the element.
  let created: CreatedEditor | undefined
  onTestFinished(() => {
    created?.editor.destroy()
    element.remove()
  })
  created = createEditor({ features, element, ...options })
  return created
}

/**
 * The live Editor a REACT-mounted `<DocumentEditor>` exposes on its
 * ProseMirror root — the supported way for component tests to reach the
 * engine (headless tests get it from {@link renderEditor} directly). Wrap the
 * first call in `waitFor` if the editor mounts asynchronously.
 */
export function editorFromDOM(): Editor {
  const el = document.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
  if (!el?.editor) throw new Error('editorFromDOM: no mounted .ProseMirror editor found')
  return el.editor
}

/** A one-paragraph document — the most common test fixture. */
export const docWith = (text: string) => ({
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})

/** Whether a node of `type` exists anywhere in a JSON document tree. */
export function jsonHasNode(node: JSONContent, type: string): boolean {
  if (node.type === type) return true
  return node.content?.some((child) => jsonHasNode(child, type)) ?? false
}

/** The first node of `type` anywhere in a JSON document tree, if any. */
export function jsonFindNode(node: JSONContent, type: string): JSONContent | undefined {
  if (node.type === type) return node
  for (const child of node.content ?? []) {
    const found = jsonFindNode(child, type)
    if (found) return found
  }
  return undefined
}

/** Parse HTML into a Slice against the editor's schema — exactly what the
 *  paste/drop pipeline feeds handleDrop. */
export function parseSliceFromHTML(editor: Editor, html: string): Slice {
  const el = document.createElement('div')
  el.innerHTML = html
  return PMDOMParser.fromSchema(editor.schema).parseSlice(el)
}

/** Dispatch a drop through PM's own handleDrop prop chain. Coordinates are
 *  fixed — every caller stubs view.posAtCoords (jsdom has no layout). */
export function dispatchDrop(view: EditorView, slice: Slice | null, moved = false) {
  return view.someProp('handleDrop', (handler) =>
    handler(
      view,
      new MouseEvent('drop', { clientX: 10, clientY: 10 }) as DragEvent,
      slice as never,
      moved,
    ),
  )
}
