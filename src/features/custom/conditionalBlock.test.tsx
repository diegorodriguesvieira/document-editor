import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { createEditor, type CreatedEditor } from '../../editor'
import type { DocumentVariable } from './documentVariables'
import { ConditionalBlockFeature, ConditionEditor, type ConditionValue } from './conditionalBlock'

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
