import { useState } from 'react'
import {
  defineFeature,
  Extension,
  mergeAttributes,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '../../editor'
import { type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { useDocumentVariable, useDocumentVariables, type DocumentVariable } from './documentVariables'

/** Hard cap on conditional-block nesting (1 = a single, top-level block). */
export const MAX_CONDITIONAL_DEPTH = 5

/** conditionalBlock ancestors at a resolved position (incl. the block it sits in). */
function conditionalDepthAt($pos: ResolvedPos): number {
  let depth = 0
  for (let d = 1; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name === 'conditionalBlock') depth++
  }
  return depth
}

/** Deepest conditionalBlock nesting anywhere in the tree (O(n), no per-pos resolve). */
function maxConditionalDepth(node: PMNode, current = 0): number {
  const here = current + (node.type.name === 'conditionalBlock' ? 1 : 0)
  let max = here
  node.forEach((child) => {
    max = Math.max(max, maxConditionalDepth(child, here))
  })
  return max
}

interface ConditionOption {
  id: string
  label: string
  needsValue: boolean
}

/**
 * Operators the backend evaluates. The `id`s are the `data-condition` contract
 * the backend reads — stable, declarative protocol constants. `needsValue`
 * toggles the value input.
 */
const CONDITIONS = [
  { id: 'EXISTS', label: 'is in the document', needsValue: false },
  { id: 'NOT_EXISTS', label: 'is not in the document', needsValue: false },
  { id: 'EQUALS', label: 'is equal to', needsValue: true },
  { id: 'NOT_EQUALS', label: 'is not equal to', needsValue: true },
  { id: 'GREATER_THAN', label: 'is greater than', needsValue: true },
  { id: 'LESS_THAN', label: 'is less than', needsValue: true },
] as const satisfies readonly ConditionOption[]

/** The condition operators as a typed set — shareable as the backend contract. */
export type ConditionId = (typeof CONDITIONS)[number]['id']

export interface ConditionValue {
  variable: string | null
  condition: string | null
  value: string | null
}

/** Pure, testable condition editor (no editor dependency). */
export function ConditionEditor({
  variables,
  value,
  onChange,
  onDone,
}: {
  variables: DocumentVariable[]
  value: ConditionValue
  onChange: (next: ConditionValue) => void
  onDone: () => void
}) {
  const condition = CONDITIONS.find((c) => c.id === value.condition)
  return (
    <div className="cond-editor">
      <label className="cond-editor__field">
        <span>Variable</span>
        <select
          aria-label="Variable"
          value={value.variable ?? ''}
          onChange={(event) => onChange({ ...value, variable: event.target.value || null })}
        >
          <option value="">Select a variable *</option>
          {variables.map((variable) => (
            <option key={variable.id} value={variable.id}>
              {variable.label}
            </option>
          ))}
        </select>
      </label>

      <label className="cond-editor__field">
        <span>Condition</span>
        <select
          aria-label="Condition"
          value={value.condition ?? ''}
          onChange={(event) => onChange({ ...value, condition: event.target.value || null })}
        >
          <option value="">Select a condition *</option>
          {CONDITIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {condition?.needsValue ? (
        <label className="cond-editor__field">
          <span>Value</span>
          <input
            aria-label="Value"
            type="text"
            value={value.value ?? ''}
            onChange={(event) => onChange({ ...value, value: event.target.value || null })}
          />
        </label>
      ) : null}

      <button type="button" className="cond-editor__done" onClick={onDone}>
        Done
      </button>
    </div>
  )
}

function conditionText(value: ConditionValue, variable: DocumentVariable | undefined): string {
  if (!value.variable || !value.condition) return 'no condition'
  const condition = CONDITIONS.find((c) => c.id === value.condition)
  const label = variable?.label ?? value.variable
  const conditionLabel = condition?.label ?? value.condition
  const valuePart = condition?.needsValue && value.value ? ` ${value.value}` : ''
  return `${label} ${conditionLabel}${valuePart}`
}

function ConditionalBlockView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const variables = useDocumentVariables()
  const [editing, setEditing] = useState(false)
  const cond: ConditionValue = {
    variable: (node.attrs.variable as string | null) ?? null,
    condition: (node.attrs.condition as string | null) ?? null,
    value: (node.attrs.value as string | null) ?? null,
  }
  const selectedVariable = useDocumentVariable(cond.variable)

  // Nesting adds an AND. Disable it once this block is already at the depth cap.
  const pos = typeof getPos === 'function' ? getPos() : null
  let depthHere = MAX_CONDITIONAL_DEPTH
  if (pos != null) {
    try {
      depthHere = conditionalDepthAt(editor.state.doc.resolve(pos + 1))
    } catch {
      depthHere = MAX_CONDITIONAL_DEPTH
    }
  }
  const atDepthLimit = depthHere >= MAX_CONDITIONAL_DEPTH
  const nestCondition = () => {
    if (pos == null) return
    // Wrap all of this block's content in a new conditionalBlock (one level deeper).
    editor
      .chain()
      .focus()
      .setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 })
      .wrapIn('conditionalBlock')
      .run()
  }

  return (
    <NodeViewWrapper className="conditional-block">
      {/* Chrome is non-editable so the selects/inputs aren't intercepted by ProseMirror. */}
      <div className="conditional-block__chrome" contentEditable={false}>
        <div className="conditional-block__bar">
          <button
            type="button"
            className="conditional-block__summary"
            onClick={() => setEditing((open) => !open)}
          >
            <span className="conditional-block__icon" aria-hidden>
              ⑂
            </span>
            <span>Show if</span>
            <span className="conditional-block__cond">{conditionText(cond, selectedVariable)}</span>
          </button>
          <button
            type="button"
            className="conditional-block__nest"
            aria-label="Add nested condition"
            title="Nest a condition (AND)"
            disabled={atDepthLimit}
            onMouseDown={(event) => event.preventDefault()}
            onClick={nestCondition}
          >
            ＋
          </button>
          <button
            type="button"
            className="conditional-block__delete"
            aria-label="Remove conditional block"
            onClick={() => deleteNode()}
          >
            🗑
          </button>
        </div>
        {editing ? (
          <ConditionEditor
            variables={variables}
            value={cond}
            onChange={(next) => updateAttributes(next)}
            onDone={() => setEditing(false)}
          />
        ) : null}
      </div>
      <NodeViewContent className="conditional-block__content" />
    </NodeViewWrapper>
  )
}

const ConditionalBlock = Node.create({
  name: 'conditionalBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  // Isolating so a join/lift across the boundary (e.g. Backspace at the start of
  // the first inner block) can't silently strip the wrapper — and with it the
  // {variable,condition,value} the backend evaluates to gate the content.
  isolating: true,

  addAttributes() {
    return {
      variable: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-variable'),
        renderHTML: (attributes) =>
          attributes.variable ? { 'data-variable': attributes.variable as string } : {},
      },
      condition: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-condition'),
        renderHTML: (attributes) =>
          attributes.condition ? { 'data-condition': attributes.condition as string } : {},
      },
      value: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-value'),
        renderHTML: (attributes) =>
          attributes.value ? { 'data-value': attributes.value as string } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-conditional-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // The backend reads data-variable/condition/value + content, evaluates the
    // condition, and includes/excludes the block when rendering the PDF.
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-conditional-block': '', class: 'conditional-block' }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConditionalBlockView)
  },
})

/**
 * Backstop for the nesting cap: rejects any transaction whose result would nest a
 * conditionalBlock deeper than MAX_CONDITIONAL_DEPTH. `conditional.nest` and the
 * node-view button pre-check for interactive nesting; this also covers paste,
 * drag and setJSON/setContent. filterTransaction rejects before the change
 * applies — no undo entry, no silent rewrite (an over-deep load/paste is dropped
 * whole). Note: the editor's INITIAL `content` isn't transaction-checked (same as
 * HeaderFooterGuard) — the consumer owns validating what it seeds.
 */
const ConditionalDepthGuard = Extension.create({
  name: 'conditionalDepthGuard',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('conditionalDepthGuard'),
        filterTransaction: (tr) =>
          !tr.docChanged || maxConditionalDepth(tr.doc) <= MAX_CONDITIONAL_DEPTH,
      }),
    ]
  },
})

/**
 * "Team" feature: wrap a block in a conditional block whose condition (variable
 * + operator + optional value) the backend evaluates at render time. Variables
 * come from {@link DocumentVariablesProvider} (shared with merge fields).
 */
export const ConditionalBlockFeature = defineFeature({
  id: 'conditionalBlock',
  extensions: () => [ConditionalBlock, ConditionalDepthGuard],
  commands: {
    'conditional.toggle': (editor) => editor.chain().focus().toggleWrap('conditionalBlock').run(),
    // Nest a new conditional inside the current one (= AND), capped at MAX depth.
    'conditional.nest': (editor) => {
      if (conditionalDepthAt(editor.state.selection.$from) >= MAX_CONDITIONAL_DEPTH) return false
      return editor.chain().focus().wrapIn('conditionalBlock').run()
    },
  },
  insert: [
    // Insert creates a top-level conditional, or nests one when the caret is
    // already inside a conditional (= AND) — capped at MAX_CONDITIONAL_DEPTH.
    // Removal is via the block's trash button, not by toggling insert off.
    { id: 'conditional', label: 'Conditional block', icon: '⑂', commandId: 'conditional.nest' },
  ],
})
