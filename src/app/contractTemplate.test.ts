import { describe, expect, it } from 'vitest'
import { isCompleteCondition } from '../features'
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
})
