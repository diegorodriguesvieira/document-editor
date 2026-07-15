import { describe, expect, it } from 'vitest'
import { BoldFeature, HistoryFeature, isCompleteCondition } from '../features'
import { fullFeatures } from './presets'
import { jsonHasNode, renderEditor } from '../test/editorHarness'
import { contractTemplate } from './contractTemplate'

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[] }

function collectConditions(node: Node, out: unknown[] = []): unknown[] {
  if (node.type === 'conditionalBlock') out.push(node.attrs?.condition)
  for (const child of node.content ?? []) collectConditions(child, out)
  return out
}

describe('contractTemplate', () => {
  it('built against the REAL full preset, every showcase block lands (schema drift turns red here)', () => {
    // A hand-rolled schema mock would let the preset and the template drift
    // apart silently — build from the real editor and pin the showcase.
    const created = renderEditor(fullFeatures)
    const template = contractTemplate(created.editor)
    for (const type of [
      'documentHeader',
      'image',
      'heading',
      'table',
      'bulletList',
      'conditionalBlock',
      'callout',
      'blockquote',
      'documentFooter',
      'variable',
    ]) {
      expect(jsonHasNode(template.doc as never, type), type).toBe(true)
    }

    const conditions = collectConditions(template.doc as Node)
    expect(conditions).toHaveLength(2) // guards the walk itself against silently finding nothing
    for (const condition of conditions) {
      expect(isCompleteCondition(condition)).toBe(true)
    }
  })

  it('degrades to plain paragraphs on a minimal preset — the CTA must never throw', () => {
    // Everything rich is schema-probed, HEADINGS included: on a preset
    // without HeadingFeature the same call loads clean.
    const created = renderEditor([HistoryFeature, BoldFeature])
    expect(() => created.api.setJSON(contractTemplate(created.editor))).not.toThrow()
    const loaded = created.api.getJSON().doc as Node
    expect(jsonHasNode(loaded as never, 'heading')).toBe(false)
    expect(jsonHasNode(loaded as never, 'paragraph')).toBe(true)
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
