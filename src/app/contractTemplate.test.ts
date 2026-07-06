import { describe, expect, it } from 'vitest'
import { isCompleteCondition } from '../features'
import { fullFeatures } from './presets'
import { renderEditor } from '../test/editorHarness'
import { contractTemplate } from './contractTemplate'

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[] }

function collectConditions(node: Node, out: unknown[] = []): unknown[] {
  if (node.type === 'conditionalBlock') out.push(node.attrs?.condition)
  for (const child of node.content ?? []) collectConditions(child, out)
  return out
}

const FULL_SCHEMA = {
  schema: {
    nodes: Object.fromEntries(
      [
        'documentHeader',
        'documentFooter',
        'heading',
        'bulletList',
        'blockquote',
        'codeBlock',
        'horizontalRule',
        'image',
        'table',
        'callout',
        'conditionalBlock',
        'mergeField',
      ].map((name) => [name, {}]),
    ),
  },
}

describe('contractTemplate', () => {
  it('seeds only complete conditions — the demo must pass the publish gate', () => {
    const template = contractTemplate(FULL_SCHEMA)
    const conditions = collectConditions(template.doc as Node)
    expect(conditions).toHaveLength(2) // guards the walk itself against silently finding nothing
    for (const condition of conditions) {
      expect(isCompleteCondition(condition)).toBe(true)
    }
  })

  it('loading the template lands the caret on body TEXT — never a node-selected logo', () => {
    // The exact "Start from a template" flow: blank editor → api.setJSON. The
    // load's mapped selection lands in a region, the guard clamps it, and the
    // result must read like "caret at the top of the document" (the leading
    // image showing up pre-selected with resize handles is the bug this pins).
    const created = renderEditor(fullFeatures)
    created.api.setJSON(contractTemplate(created.editor))

    const selection = created.editor.state.selection
    expect(selection.toJSON().type).not.toBe('node')
    expect(selection.empty).toBe(true)
    const parent = created.editor.state.doc.resolve(selection.from).parent
    expect(parent.isTextblock).toBe(true)
    expect(created.editor.view.dom.querySelector('.image-resizer--selected')).toBeNull()
  })
})
