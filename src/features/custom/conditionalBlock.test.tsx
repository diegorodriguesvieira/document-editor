import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { DocumentEditor, type EditorApi } from '../../editor'
import { docWith, editorFromDOM, jsonHasNode, jsonFindNode, renderEditor } from '../../test/editorHarness'
import { DocumentVariablesProvider, type DocumentVariable } from './documentVariables'
import {
  ConditionalBlockFeature,
  ConditionEditor,
  isCompleteCondition,
  MAX_CONDITIONAL_DEPTH,
  type Condition,
} from './conditionalBlock'

/** Canonical single-comparison condition: `ref` EXISTS. */
const existsCondition = (ref: string): Condition => ({
  all: [{ op: 'EXISTS', params: [{ type: 'variable', ref }] }],
})

/** Canonical `ref` EQUALS `value` condition (typed literal). */
const equalsCondition = (ref: string, value: string | number): Condition => ({
  all: [
    {
      op: 'EQUALS',
      params: [
        { type: 'variable', ref },
        { type: 'literal', value },
      ],
    },
  ],
})

/** What a freshly inserted block carries (the documented contract default). */
const DRAFT = { all: [{ op: null, params: [null, null] }] }

  /** Paste a data-condition payload through a fresh editor and read back the
   *  attr — the shape-guard rig every degradation test shares. Strings pass
   *  through RAW (some payloads are deliberately exact). */
  const pasteCondition = (condition: unknown): unknown => {
    const created = renderEditor([ConditionalBlockFeature])
    const payload = typeof condition === 'string' ? condition : JSON.stringify(condition)
    created.editor.commands.insertContent(
      `<div data-conditional-block data-condition='${payload}'><p>x</p></div>`,
    )
    return jsonFindNode(created.api.getJSON().doc, 'conditionalBlock')?.attrs?.condition
  }

/** Wrap `inner` in `depth` nested conditionalBlocks. */
function nestedConditional(depth: number, inner: JSONContent): JSONContent {
  let node = inner
  for (let i = 0; i < depth; i++) {
    node = {
      type: 'conditionalBlock',
      attrs: { condition: existsCondition(`v${i}`) },
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
    const created = renderEditor([ConditionalBlockFeature], { content: docWith('clause') })
    expect(created.api.exec('conditional.wrap')).toBe(true)
    expect(jsonHasNode(created.api.getJSON().doc, 'conditionalBlock')).toBe(true)
  })

  it('a freshly wrapped block carries the draft condition (the contract default)', () => {
    const created = renderEditor([ConditionalBlockFeature], { content: docWith('clause') })
    created.api.exec('conditional.wrap')
    const block = created.api.getJSON().doc.content?.find((n) => n.type === 'conditionalBlock')
    expect(block?.attrs?.condition).toEqual(DRAFT)
  })

  it('is isolating so edits across its boundary cannot strip the wrapper', () => {
    const created = renderEditor([ConditionalBlockFeature])
    expect(created.editor.schema.nodes.conditionalBlock.spec.isolating).toBe(true)
  })

  it('keeps a trailing paragraph after the block so you can type below it', () => {
    const created = renderEditor([ConditionalBlockFeature], { content: docWith('clause') })
    created.api.exec('conditional.wrap') // the block becomes the last node

    const content = created.api.getJSON().doc.content ?? []
    expect(content[content.length - 1]?.type).toBe('paragraph')
  })

  it('serializes the condition as data-condition JSON for the backend', () => {
    const created = renderEditor([ConditionalBlockFeature])
    created.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          {
            type: 'conditionalBlock',
            attrs: { condition: existsCondition('gross.salary') },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
          },
        ],
      },
    })

    const html = created.api.getHTML()
    expect(html).toContain('data-conditional-block')
    // JSON inside an HTML attribute — quotes come out entity-escaped.
    expect(html).toContain('data-condition="{&quot;all&quot;')
    expect(html).toContain('&quot;op&quot;:&quot;EXISTS&quot;')
    expect(html).toContain('&quot;ref&quot;:&quot;gross.salary&quot;')
    // The old three-attribute contract is gone.
    expect(html).not.toContain('data-variable=')
    expect(html).not.toContain('data-value=')

    const block = created.api.getJSON().doc.content?.[0]
    expect(block?.attrs?.condition).toEqual(existsCondition('gross.salary'))
  })

  it('parses its own HTML back to the same condition (paste round-trip)', () => {
    const condition = equalsCondition('valor.mensal', 10000)
    const source = renderEditor([ConditionalBlockFeature])
    source.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          {
            type: 'conditionalBlock',
            attrs: { condition },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'gated' }] }],
          },
        ],
      },
    })

    const target = renderEditor([ConditionalBlockFeature])
    target.editor.commands.insertContent(source.api.getHTML())
    const block = target.api
      .getJSON()
      .doc.content?.find((n) => n.type === 'conditionalBlock')
    expect(block?.attrs?.condition).toEqual(condition)
  })

  it('degrades a malformed/legacy data-condition to a draft instead of breaking the paste', () => {
    const created = renderEditor([ConditionalBlockFeature])
    // Legacy HTML: data-condition used to carry the bare operator id — not JSON.
    created.editor.commands.insertContent(
      '<div data-conditional-block data-variable="pais" data-condition="EQUALS" data-value="brazil"><p>x</p></div>',
    )
    const block = created.api
      .getJSON()
      .doc.content?.find((n) => n.type === 'conditionalBlock')
    expect(block).toBeDefined()
    expect(block?.attrs?.condition).toEqual(DRAFT)
  })

  it('degrades an op:null leaf with WRONG params length to a draft (empty params would swallow the variable pick)', () => {
    // The form writes via params.map — an empty array drops every write, so
    // the shape guard must refuse drafts outside the 1–2 slot range.
    expect(pasteCondition('{"all":[{"op":null,"params":[]}]}')).toEqual(DRAFT)
    expect(pasteCondition(`{"all":[{"op":null,"params":${JSON.stringify(Array(50).fill(null))}}]}`)).toEqual(DRAFT)
    // A normal two-hole draft still round-trips untouched.
    expect(pasteCondition('{"all":[{"op":null,"params":[null,null]}]}')).toEqual({
      all: [{ op: null, params: [null, null] }],
    })
  })

  it('degrades prototype-chain and wrong-arity ops to a draft (never a fake operator)', () => {
    for (const condition of [
      { op: 'toString', params: [] }, // Object.prototype key ≠ operator
      { op: 'EXISTS', params: [{ type: 'variable', ref: 'a' }, null] }, // unary with 2 params
    ]) {
      expect(pasteCondition(condition)).toEqual(DRAFT)
    }
  })

  it('caps the pasted condition tree: over-deep and over-wide payloads degrade to a draft', () => {
    const LEAF = { op: 'EXISTS', params: [{ type: 'variable', ref: 'a' }] }
    const deep = (levels: number) => {
      let c: unknown = LEAF
      for (let i = 0; i < levels; i++) c = { all: [c] }
      return c
    }
    const wide = (leaves: number) => ({ all: Array.from({ length: leaves }, () => LEAF) })
    expect(pasteCondition(deep(2))).toEqual(deep(2)) // control: sane nesting survives
    expect(pasteCondition(deep(12))).toEqual(DRAFT) // depth cap
    expect(pasteCondition(wide(51))).toEqual(DRAFT) // leaf cap
  })

  it('round-trips a draft condition (null holes) through HTML unchanged', () => {
    const partialDraft: Condition = {
      all: [{ op: 'EQUALS', params: [{ type: 'variable', ref: 'gross.salary' }, null] }],
    }
    const source = renderEditor([ConditionalBlockFeature])
    source.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          {
            type: 'conditionalBlock',
            attrs: { condition: partialDraft },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'gated' }] }],
          },
        ],
      },
    })

    const target = renderEditor([ConditionalBlockFeature])
    target.editor.commands.insertContent(source.api.getHTML())
    const block = target.api.getJSON().doc.content?.find((n) => n.type === 'conditionalBlock')
    expect(block?.attrs?.condition).toEqual(partialDraft)
  })

  it('degrades an old-format condition attr arriving via doc JSON to a draft in the node view', async () => {
    // setJSON/content bypass parseHTML — the node-view shape guard is the only defense.
    render(
      <DocumentEditor
        features={[ConditionalBlockFeature]}
        content={{
          doc: {
            type: 'doc',
            content: [
              {
                type: 'conditionalBlock',
                // Legacy doc JSON: condition carried the bare operator string.
                attrs: { variable: 'pais', condition: 'EQUALS', value: 'brazil' },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
              },
            ],
          },
        }}
      />,
    )
    expect(await screen.findByText('no conditions set')).toBeInTheDocument()
  })
})

describe('isCompleteCondition', () => {
  it('accepts a finished comparison and full trees', () => {
    expect(isCompleteCondition(equalsCondition('pais', 'brazil'))).toBe(true)
    expect(isCompleteCondition(existsCondition('pais'))).toBe(true)
    expect(
      isCompleteCondition({
        any: [
          { op: 'EXISTS', params: [{ type: 'variable', ref: 'a' }] },
          {
            all: [
              { op: 'EQUALS', params: [{ type: 'variable', ref: 'b' }, { type: 'literal', value: 1 }] },
              { op: 'EXISTS', params: [{ type: 'variable', ref: 'c' }] },
            ],
          },
        ],
      }),
    ).toBe(true)
  })

  it('rejects drafts, wrong arity, unknown ops and malformed shapes', () => {
    expect(isCompleteCondition(DRAFT)).toBe(false)
    expect(isCompleteCondition(null)).toBe(false)
    expect(isCompleteCondition('EQUALS')).toBe(false)
    expect(isCompleteCondition({ all: [] })).toBe(false)
    // Missing second param for a binary operator.
    expect(
      isCompleteCondition({ all: [{ op: 'EQUALS', params: [{ type: 'variable', ref: 'a' }] }] }),
    ).toBe(false)
    // Unary operator carrying a stray second param.
    expect(
      isCompleteCondition({
        all: [{ op: 'EXISTS', params: [{ type: 'variable', ref: 'a' }, { type: 'literal', value: 1 }] }],
      }),
    ).toBe(false)
    expect(
      isCompleteCondition({ all: [{ op: 'BETWEEN', params: [{ type: 'variable', ref: 'a' }] }] }),
    ).toBe(false)
    // A node can't be two forms at once.
    expect(isCompleteCondition({ all: [existsCondition('a')], any: [] })).toBe(false)
    // Empty variable ref: shape-valid (paste can carry it) but not publishable —
    // the backend rejects it (spec §4 "invalid variable ref").
    expect(
      isCompleteCondition({ all: [{ op: 'EXISTS', params: [{ type: 'variable', ref: '' }] }] }),
    ).toBe(false)
    // Infinity isn't JSON — it would stringify to null in data-condition.
    expect(
      isCompleteCondition({
        all: [{ op: 'EQUALS', params: [{ type: 'variable', ref: 'a' }, { type: 'literal', value: Infinity }] }],
      }),
    ).toBe(false)
  })
})

describe('conditional block — nesting (max 5)', () => {
  it('round-trips a nested structure with nested data-* wrappers', () => {
    const created = renderEditor([ConditionalBlockFeature])
    created.api.setJSON(docOfDepth(2))
    expect(maxDepthJSON(created.api.getJSON().doc)).toBe(2)
    expect(created.api.getHTML().match(/data-conditional-block/g)?.length).toBe(2)
  })

  it('wraps into a nested block when already inside one (= AND), never unwrapping', () => {
    const created = renderEditor([ConditionalBlockFeature], { content: docWith('clause') })
    expect(created.api.exec('conditional.wrap')).toBe(true) // top-level
    expect(maxDepthJSON(created.api.getJSON().doc)).toBe(1)
    expect(created.api.exec('conditional.wrap')).toBe(true) // nests, doesn't lift
    expect(maxDepthJSON(created.api.getJSON().doc)).toBe(2)
  })

  it('wrap no-ops at the depth cap', () => {
    const created = renderEditor([ConditionalBlockFeature])
    created.api.setJSON(docOfDepth(MAX_CONDITIONAL_DEPTH))
    // Put the cursor inside the innermost block (its text is the deepest text node).
    let target = 0
    created.editor.state.doc.descendants((node, pos) => {
      if (node.isText) target = pos
    })
    created.editor.commands.setTextSelection(target + 1)
    expect(created.api.exec('conditional.wrap')).toBe(false)
    expect(maxDepthJSON(created.api.getJSON().doc)).toBe(MAX_CONDITIONAL_DEPTH)
  })

  it('rejects a setJSON that would nest deeper than the cap', () => {
    const created = renderEditor([ConditionalBlockFeature], { content: docWith('keep') })
    created.api.setJSON(docOfDepth(MAX_CONDITIONAL_DEPTH + 1)) // 6 levels → rejected whole
    const doc = created.api.getJSON().doc
    expect(maxDepthJSON(doc)).toBeLessThanOrEqual(MAX_CONDITIONAL_DEPTH)
    expect(jsonHasNode(doc, 'conditionalBlock')).toBe(false)
  })
})

describe('conditional block — editing around the isolating boundary', () => {
  it('splits into a second paragraph inside the same block on Enter', () => {
    const created = renderEditor([ConditionalBlockFeature], { content: docOfDepth(1) })
    let end = 0
    created.editor.state.doc.descendants((n, pos) => {
      if (n.isText) end = pos + n.nodeSize
    })
    created.editor.commands.setTextSelection(end)
    created.editor.commands.splitBlock()

    const block = created.api.getJSON().doc.content?.[0]
    expect((block?.content ?? []).map((k) => k.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('lets you type after a nested block (gap cursor), landing inside the parent', () => {
    const created = renderEditor([ConditionalBlockFeature], {
      content: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'conditionalBlock',
              attrs: { condition: equalsCondition('pais', 'brazil') },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'brazil' }] },
                {
                  type: 'conditionalBlock',
                  attrs: { condition: equalsCondition('x', 'holanda') },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'holanda' }] }],
                },
              ],
            },
          ],
        },
      },
    })
    // Right after the INNER block, still inside the outer.
    let innerEnd = 0
    created.editor.state.doc.descendants((n, pos) => {
      if (n.type.name === 'conditionalBlock' && JSON.stringify(n.attrs.condition).includes('holanda'))
        innerEnd = pos + n.nodeSize
    })
    const $pos = created.editor.state.doc.resolve(innerEnd)
    created.editor.view.dispatch(created.editor.state.tr.setSelection(new GapCursor($pos)))
    created.editor.commands.insertContent('after')

    // The new paragraph lands inside the OUTER block, after the inner one.
    const outer = created.api.getJSON().doc.content?.[0]
    const kids = outer?.content ?? []
    expect(kids.map((k) => k.type)).toEqual(['paragraph', 'conditionalBlock', 'paragraph'])
    expect(kids[2]?.content?.[0]?.text).toBe('after')
  })
})

describe('conditional block — removing an empty line next to a nested block', () => {
  const DOC_WITH_EMPTY_LINE = {
    doc: {
      type: 'doc',
      content: [
        {
          type: 'conditionalBlock',
          content: [
            { type: 'paragraph' }, // the stuck empty line
            {
              type: 'conditionalBlock',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
            },
          ],
        },
      ],
    },
  }

  // Dispatch a REAL keydown: `commands.keyboardShortcut` replays only the
  // captured STEPS, dropping the selection our handler sets.
  const pressBackspace = (editor: Editor) =>
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    )

  it('Backspace removes it (isolating otherwise makes every key a no-op) and leaves the gap cursor', () => {
    const created = renderEditor([ConditionalBlockFeature])
    created.api.setJSON(DOC_WITH_EMPTY_LINE)
    created.editor.commands.focus()
    created.editor.commands.setTextSelection(2) // caret in the empty first line
    pressBackspace(created.editor)

    const kids = created.api.getJSON().doc.content?.[0]?.content ?? []
    expect(kids.map((k) => k.type)).toEqual(['conditionalBlock'])
    expect(created.editor.state.selection.toJSON().type).toBe('gapcursor')
  })

  it('never removes the block last line (the schema needs block+)', () => {
    const created = renderEditor([ConditionalBlockFeature])
    created.api.setJSON({
      doc: { type: 'doc', content: [{ type: 'conditionalBlock', content: [{ type: 'paragraph' }] }] },
    })
    created.editor.commands.focus()
    created.editor.commands.setTextSelection(2)
    pressBackspace(created.editor)

    const kids = created.api.getJSON().doc.content?.[0]?.content ?? []
    expect(kids.map((k) => k.type)).toEqual(['paragraph'])
  })
})

describe('conditional block — the ＋ (add nested) button', () => {
  it('appends an empty nested block on click, keeping existing text above it', async () => {
    const user = userEvent.setup()
    let api: EditorApi | null = null
    render(
      <DocumentEditor
        features={[ConditionalBlockFeature]}
        content={{
          doc: {
            type: 'doc',
            content: [
              {
                type: 'conditionalBlock',
                attrs: { condition: equalsCondition('pais', 'brazil') },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'brazil' }] }],
              },
            ],
          },
        }}
        onReady={(ready) => {
          api = ready
        }}
      />,
    )

    const nestBtn = await screen.findByRole('button', { name: 'Add nested condition' })
    expect(nestBtn).toBeEnabled()
    await user.click(nestBtn)
    // The click chains .focus(), which TipTap defers a frame — drain it inside
    // act so the follow-up node-view render isn't an orphan update.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    await waitFor(() => {
      const kids = api?.getJSON().doc.content?.[0]?.content ?? []
      expect(kids).toHaveLength(2)
      expect(kids[0]?.content?.[0]?.text).toBe('brazil') // text stays on top…
      expect(kids[1]?.type).toBe('conditionalBlock') // …nested added below
    })

    // …and focus lands INSIDE the new nested block: typing fills its content.
    act(() => {
      editorFromDOM().commands.insertContent('X')
    })
    const nested = api!.getJSON().doc.content?.[0]?.content?.[1]
    expect(nested?.content?.[0]?.content?.[0]?.text).toBe('X')
  })

  it('replaces a trailing EMPTY line with the nested block (no blank line left above)', async () => {
    const user = userEvent.setup()
    let api: EditorApi | null = null
    render(
      <DocumentEditor
        features={[ConditionalBlockFeature]}
        content={{
          doc: {
            type: 'doc',
            // A freshly created conditional: its only child is an empty paragraph.
            content: [{ type: 'conditionalBlock', content: [{ type: 'paragraph' }] }],
          },
        }}
        onReady={(ready) => {
          api = ready
        }}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Add nested condition' }))

    await waitFor(() => {
      const kids = api?.getJSON().doc.content?.[0]?.content ?? []
      // The empty line was consumed — the nested block is the only child.
      expect(kids.map((k) => k.type)).toEqual(['conditionalBlock'])
    })
  })
})

const VARS: DocumentVariable[] = [
  { id: 'gross.salary', label: 'Gross salary' },
  { id: 'company.name', label: 'Company' },
]

function ControlledEditor({
  variables,
  onState,
}: {
  variables: DocumentVariable[]
  onState?: (next: Condition) => void
}) {
  const [value, setValue] = useState<Condition>({ all: [{ op: null, params: [null, null] }] })
  return (
    <ConditionEditor
      variables={variables}
      value={value}
      onChange={(next) => {
        setValue(next)
        onState?.(next)
      }}
      onDone={() => {}}
    />
  )
}

describe('<ConditionEditor />', () => {
  it('selects variable/condition and reveals the comparison operand only when binary', async () => {
    const user = userEvent.setup()
    render(<ControlledEditor variables={VARS} />)

    // No right-hand operand UI for a unary-or-unset condition.
    expect(screen.queryByLabelText('Value')).toBeNull()
    expect(screen.queryByLabelText('Compare with')).toBeNull()

    await user.selectOptions(screen.getByLabelText('Variable'), 'gross.salary')
    await user.selectOptions(screen.getByLabelText('Condition'), 'GREATER_THAN')

    // A binary operator needs a right-hand side → value input appears.
    expect(screen.getByLabelText('Value')).toBeInTheDocument()
    expect((screen.getByLabelText('Variable') as HTMLSelectElement).value).toBe('gross.salary')

    // A unary condition hides it again.
    await user.selectOptions(screen.getByLabelText('Condition'), 'EXISTS')
    expect(screen.queryByLabelText('Value')).toBeNull()
  })

  it('emits the canonical {all:[leaf]} with typed operands — numeric input becomes a number', async () => {
    const user = userEvent.setup()
    let last: Condition | null = null
    render(<ControlledEditor variables={VARS} onState={(next) => (last = next)} />)

    await user.selectOptions(screen.getByLabelText('Variable'), 'gross.salary')
    await user.selectOptions(screen.getByLabelText('Condition'), 'GREATER_THAN')
    await user.type(screen.getByLabelText('Value'), '10000')

    expect(last).toEqual({
      all: [
        {
          op: 'GREATER_THAN',
          params: [
            { type: 'variable', ref: 'gross.salary' },
            { type: 'literal', value: 10000 },
          ],
        },
      ],
    })
    expect(isCompleteCondition(last)).toBe(true)
  })

  it('compares against another variable via the "Compare with" toggle', async () => {
    const user = userEvent.setup()
    let last: Condition | null = null
    render(<ControlledEditor variables={VARS} onState={(next) => (last = next)} />)

    await user.selectOptions(screen.getByLabelText('Variable'), 'gross.salary')
    await user.selectOptions(screen.getByLabelText('Condition'), 'EQUALS')
    await user.selectOptions(screen.getByLabelText('Compare with'), 'variable')
    await user.selectOptions(screen.getByLabelText('Comparison variable'), 'company.name')

    expect(last).toEqual({
      all: [
        {
          op: 'EQUALS',
          params: [
            { type: 'variable', ref: 'gross.salary' },
            { type: 'variable', ref: 'company.name' },
          ],
        },
      ],
    })
  })

  it('resizes params to the operator arity (unary truncates the right operand)', async () => {
    const user = userEvent.setup()
    let last: Condition | null = null
    render(<ControlledEditor variables={VARS} onState={(next) => (last = next)} />)

    await user.selectOptions(screen.getByLabelText('Variable'), 'gross.salary')
    await user.selectOptions(screen.getByLabelText('Condition'), 'EQUALS')
    await user.type(screen.getByLabelText('Value'), '1')
    await user.selectOptions(screen.getByLabelText('Condition'), 'EXISTS')

    expect(last).toEqual({
      all: [{ op: 'EXISTS', params: [{ type: 'variable', ref: 'gross.salary' }] }],
    })
    expect(isCompleteCondition(last)).toBe(true)
  })

  it('clears a stale literal when "Compare with" is toggled to a variable', async () => {
    const user = userEvent.setup()
    let last: Condition | null = null
    render(<ControlledEditor variables={VARS} onState={(next) => (last = next)} />)

    await user.selectOptions(screen.getByLabelText('Variable'), 'gross.salary')
    await user.selectOptions(screen.getByLabelText('Condition'), 'EQUALS')
    await user.type(screen.getByLabelText('Value'), 'hello')
    await user.selectOptions(screen.getByLabelText('Compare with'), 'variable')

    // The literal belongs to the other face — it must not linger in params[1].
    expect(last).toEqual({
      all: [{ op: 'EQUALS', params: [{ type: 'variable', ref: 'gross.salary' }, null] }],
    })
    expect(isCompleteCondition(last)).toBe(false)
  })

  it('pins the string-vs-number literal boundary (spec §2.4 JSON-number grammar)', async () => {
    const user = userEvent.setup()
    let last: Condition | null = null
    render(<ControlledEditor variables={VARS} onState={(next) => (last = next)} />)
    await user.selectOptions(screen.getByLabelText('Variable'), 'gross.salary')
    await user.selectOptions(screen.getByLabelText('Condition'), 'EQUALS')
    const value = screen.getByLabelText('Value')
    const lastLiteral = () => {
      const leaf = (last as unknown as { all: [{ params: unknown[] }] }).all[0]
      return leaf.params[1]
    }

    await user.type(value, '0001') // leading zeros: not a JSON number → stays a string
    expect(lastLiteral()).toEqual({ type: 'literal', value: '0001' })

    await user.clear(value)
    await user.type(value, '1e3') // JSON exponent form → number
    expect(lastLiteral()).toEqual({ type: 'literal', value: 1000 })

    await user.clear(value)
    await user.type(value, '-3.5')
    expect(lastLiteral()).toEqual({ type: 'literal', value: -3.5 })

    await user.clear(value)
    await user.type(value, '1e999') // overflows to Infinity → must stay a string (JSON-safe)
    expect(lastLiteral()).toEqual({ type: 'literal', value: '1e999' })

    await user.clear(value)
    await user.type(value, '1.2.3') // not a number → free text
    expect(lastLiteral()).toEqual({ type: 'literal', value: '1.2.3' })
  })

  it('does not canonicalize the value input while typing ("1.50" keeps its trailing zero)', async () => {
    const user = userEvent.setup()
    let last: Condition | null = null
    render(<ControlledEditor variables={VARS} onState={(next) => (last = next)} />)
    await user.selectOptions(screen.getByLabelText('Variable'), 'gross.salary')
    await user.selectOptions(screen.getByLabelText('Condition'), 'EQUALS')

    const value = screen.getByLabelText('Value') as HTMLInputElement
    await user.type(value, '1.50')
    expect(value.value).toBe('1.50') // the box shows what was typed…
    expect((last as unknown as { all: [{ params: unknown[] }] }).all[0].params[1]).toEqual({
      type: 'literal',
      value: 1.5, // …while the stored literal is the parsed number
    })
  })

  it('refuses to flatten a multi-condition tree it cannot represent', () => {
    const leaves = [
      { op: 'EXISTS' as const, params: [{ type: 'variable' as const, ref: 'a' }] },
      { op: 'EXISTS' as const, params: [{ type: 'variable' as const, ref: 'b' }] },
    ]
    for (const tree of [{ any: leaves }, { all: leaves }] as Condition[]) {
      const { unmount } = render(
        <ConditionEditor variables={VARS} value={tree} onChange={() => {}} onDone={() => {}} />,
      )
      expect(screen.queryByLabelText('Variable')).toBeNull()
      expect(screen.getByText(/multi-condition rule/)).toBeInTheDocument()
      unmount()
    }
  })
})

describe('conditional block — summary bar text', () => {
  const blockDoc = (condition: unknown) => ({
    doc: {
      type: 'doc',
      content: [
        {
          type: 'conditionalBlock',
          attrs: { condition },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
        },
      ],
    },
  })
  const renderSummary = async (condition: unknown) => {
    const { container } = render(
      <DocumentVariablesProvider variables={VARS}>
        <DocumentEditor features={[ConditionalBlockFeature]} content={blockDoc(condition)} />
      </DocumentVariablesProvider>,
    )
    await waitFor(() =>
      expect(container.querySelector('.conditional-block__cond')).not.toBeNull(),
    )
    return container.querySelector('.conditional-block__cond')?.textContent
  }

  it('resolves variable labels and renders typed literals', async () => {
    expect(
      await renderSummary({
        all: [
          {
            op: 'GREATER_THAN',
            params: [
              { type: 'variable', ref: 'gross.salary' },
              { type: 'literal', value: 10000 },
            ],
          },
        ],
      }),
    ).toBe('Gross salary is greater than 10000')
  })

  it('renders a draft as "no conditions set"', async () => {
    expect(await renderSummary({ all: [{ op: null, params: [null, null] }] })).toBe(
      'no conditions set',
    )
  })

  it('joins an any-tree with "or" (format ahead of the single-row UI)', async () => {
    expect(
      await renderSummary({
        any: [
          { op: 'EXISTS', params: [{ type: 'variable', ref: 'gross.salary' }] },
          { op: 'EXISTS', params: [{ type: 'variable', ref: 'company.name' }] },
        ],
      }),
    ).toBe('Gross salary is in the document or Company is in the document')
  })
})
