import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { createEditor, DocumentEditor, type CreatedEditor } from '../../editor'
import type { DocumentVariable } from './documentVariables'
import {
  ConditionalBlockFeature,
  ConditionEditor,
  MAX_CONDITIONAL_DEPTH,
  type ConditionValue,
} from './conditionalBlock'

let created: CreatedEditor | undefined

afterEach(() => {
  created?.editor.destroy()
  created = undefined
})

function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

function hasNode(node: JSONContent, type: string): boolean {
  if (node.type === type) return true
  return node.content?.some((child) => hasNode(child, type)) ?? false
}

const docWith = (text: string) => ({
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})

/** Wrap `inner` in `depth` nested conditionalBlocks. */
function nestedConditional(depth: number, inner: JSONContent): JSONContent {
  let node = inner
  for (let i = 0; i < depth; i++) {
    node = {
      type: 'conditionalBlock',
      attrs: { variable: `v${i}`, condition: 'EXISTS', value: null },
      content: [node],
    }
  }
  return node
}

const docOfDepth = (depth: number) => ({
  doc: {
    type: 'doc',
    content: [nestedConditional(depth, { type: 'paragraph', content: [{ type: 'text', text: 'x' }] })],
  },
})

/** Deepest conditionalBlock nesting in a JSON doc. */
function maxDepthJSON(node: JSONContent, current = 0): number {
  const here = current + (node.type === 'conditionalBlock' ? 1 : 0)
  return (node.content ?? []).reduce((max, child) => Math.max(max, maxDepthJSON(child, here)), here)
}

describe('conditional block', () => {
  it('wraps the current block in a conditionalBlock', () => {
    created = createEditor({
      features: [ConditionalBlockFeature],
      element: mountTarget(),
      content: docWith('clause'),
    })
    expect(created.api.exec('conditional.toggle')).toBe(true)
    expect(hasNode(created.api.getJSON().doc, 'conditionalBlock')).toBe(true)
  })

  it('is isolating so edits across its boundary cannot strip the wrapper', () => {
    created = createEditor({ features: [ConditionalBlockFeature], element: mountTarget() })
    expect(created.editor.schema.nodes.conditionalBlock.spec.isolating).toBe(true)
  })

  it('keeps a trailing paragraph after the block so you can type below it', () => {
    created = createEditor({
      features: [ConditionalBlockFeature],
      element: mountTarget(),
      content: docWith('clause'),
    })
    created.api.exec('conditional.toggle') // the block becomes the last node

    const content = created.api.getJSON().doc.content ?? []
    expect(content[content.length - 1]?.type).toBe('paragraph')
  })

  it('serializes the condition to data-* attrs for the backend', () => {
    created = createEditor({ features: [ConditionalBlockFeature], element: mountTarget() })
    created.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          {
            type: 'conditionalBlock',
            attrs: { variable: 'gross.salary', condition: 'EXISTS', value: null },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
          },
        ],
      },
    })

    const html = created.api.getHTML()
    expect(html).toContain('data-conditional-block')
    expect(html).toContain('data-variable="gross.salary"')
    expect(html).toContain('data-condition="EXISTS"')

    const block = created.api.getJSON().doc.content?.[0]
    expect(block?.attrs).toMatchObject({ variable: 'gross.salary', condition: 'EXISTS' })
  })
})

describe('conditional block — nesting (max 5)', () => {
  it('round-trips a nested structure with nested data-* wrappers', () => {
    created = createEditor({ features: [ConditionalBlockFeature], element: mountTarget() })
    created.api.setJSON(docOfDepth(2))
    expect(maxDepthJSON(created.api.getJSON().doc)).toBe(2)
    expect(created.api.getHTML().match(/data-conditional-block/g)?.length).toBe(2)
  })

  it('conditional.nest wraps the current block in another (= AND)', () => {
    created = createEditor({
      features: [ConditionalBlockFeature],
      element: mountTarget(),
      content: docWith('clause'),
    })
    created.api.exec('conditional.toggle')
    expect(maxDepthJSON(created.api.getJSON().doc)).toBe(1)
    expect(created.api.exec('conditional.nest')).toBe(true)
    expect(maxDepthJSON(created.api.getJSON().doc)).toBe(2)
  })

  it('conditional.nest no-ops at the depth cap', () => {
    created = createEditor({ features: [ConditionalBlockFeature], element: mountTarget() })
    created.api.setJSON(docOfDepth(MAX_CONDITIONAL_DEPTH))
    // Put the cursor inside the innermost block (its text is the deepest text node).
    let target = 0
    created.editor.state.doc.descendants((node, pos) => {
      if (node.isText) target = pos
    })
    created.editor.commands.setTextSelection(target + 1)
    expect(created.api.exec('conditional.nest')).toBe(false)
    expect(maxDepthJSON(created.api.getJSON().doc)).toBe(MAX_CONDITIONAL_DEPTH)
  })

  it('rejects a setJSON that would nest deeper than the cap', () => {
    created = createEditor({
      features: [ConditionalBlockFeature],
      element: mountTarget(),
      content: docWith('keep'),
    })
    created.api.setJSON(docOfDepth(MAX_CONDITIONAL_DEPTH + 1)) // 6 levels → rejected whole
    const doc = created.api.getJSON().doc
    expect(maxDepthJSON(doc)).toBeLessThanOrEqual(MAX_CONDITIONAL_DEPTH)
    expect(hasNode(doc, 'conditionalBlock')).toBe(false)
  })
})

describe('conditional block — nesting via the UI', () => {
  it('shows an enabled "nest" button that adds a level on click', async () => {
    const user = userEvent.setup()
    render(<DocumentEditor features={[ConditionalBlockFeature]} content={docOfDepth(1)} />)

    const nestBtn = await screen.findByRole('button', { name: 'Add nested condition' })
    expect(nestBtn).toBeEnabled()
    expect(document.querySelectorAll('.conditional-block').length).toBe(1)

    await user.click(nestBtn)

    await waitFor(() => {
      expect(document.querySelectorAll('.conditional-block').length).toBe(2)
    })
  })

  it('inserting a conditional while inside one nests it (= AND) instead of unwrapping', () => {
    created = createEditor({
      features: [ConditionalBlockFeature],
      element: mountTarget(),
      content: docWith('clause'),
    })
    // First insert wraps the paragraph (top-level conditional).
    expect(created.api.exec('conditional.nest')).toBe(true)
    expect(maxDepthJSON(created.api.getJSON().doc)).toBe(1)
    // Second insert, caret still inside, nests rather than lifting.
    expect(created.api.exec('conditional.nest')).toBe(true)
    expect(maxDepthJSON(created.api.getJSON().doc)).toBe(2)
  })
})

const VARS: DocumentVariable[] = [
  { id: 'gross.salary', label: 'Gross salary' },
  { id: 'company.name', label: 'Company' },
]

function ControlledEditor({ variables }: { variables: DocumentVariable[] }) {
  const [value, setValue] = useState<ConditionValue>({ variable: null, condition: null, value: null })
  return <ConditionEditor variables={variables} value={value} onChange={setValue} onDone={() => {}} />
}

describe('<ConditionEditor />', () => {
  it('selects variable/condition and reveals the value input only when needed', async () => {
    const user = userEvent.setup()
    render(<ControlledEditor variables={VARS} />)

    // No value input for a value-less condition.
    expect(screen.queryByLabelText('Value')).toBeNull()

    await user.selectOptions(screen.getByLabelText('Variable'), 'gross.salary')
    await user.selectOptions(screen.getByLabelText('Condition'), 'GREATER_THAN')

    // greaterThan needs a value → input appears.
    expect(screen.getByLabelText('Value')).toBeInTheDocument()
    expect((screen.getByLabelText('Variable') as HTMLSelectElement).value).toBe('gross.salary')

    // A value-less condition hides it again.
    await user.selectOptions(screen.getByLabelText('Condition'), 'EXISTS')
    expect(screen.queryByLabelText('Value')).toBeNull()
  })
})
