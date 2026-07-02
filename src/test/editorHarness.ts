import { onTestFinished } from 'vitest'
import type { JSONContent } from '@tiptap/core'
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
