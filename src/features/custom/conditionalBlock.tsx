import { useState } from 'react'
import {
  defineFeature,
  mergeAttributes,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '../../editor'
import { useDocumentVariable, useDocumentVariables, type DocumentVariable } from './documentVariables'

interface ConditionOption {
  id: string
  label: string
  needsValue: boolean
}

/** Operators the backend evaluates. `needsValue` toggles the value input. */
const CONDITIONS: ConditionOption[] = [
  { id: 'present', label: 'is in the document', needsValue: false },
  { id: 'absent', label: 'is not in the document', needsValue: false },
  { id: 'equals', label: 'is equal to', needsValue: true },
  { id: 'notEquals', label: 'is not equal to', needsValue: true },
  { id: 'greaterThan', label: 'is greater than', needsValue: true },
  { id: 'lessThan', label: 'is less than', needsValue: true },
]

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

function ConditionalBlockView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const variables = useDocumentVariables()
  const [editing, setEditing] = useState(false)
  const cond: ConditionValue = {
    variable: (node.attrs.variable as string | null) ?? null,
    condition: (node.attrs.condition as string | null) ?? null,
    value: (node.attrs.value as string | null) ?? null,
  }
  const selectedVariable = useDocumentVariable(cond.variable)

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
 * "Team" feature: wrap a block in a conditional block whose condition (variable
 * + operator + optional value) the backend evaluates at render time. Variables
 * come from {@link DocumentVariablesProvider} (shared with merge fields).
 */
export const ConditionalBlockFeature = defineFeature({
  id: 'conditionalBlock',
  extensions: () => [ConditionalBlock],
  commands: {
    'conditional.toggle': (editor) => editor.chain().focus().toggleWrap('conditionalBlock').run(),
  },
  insert: [
    { id: 'conditional', label: 'Conditional block', icon: '⑂', commandId: 'conditional.toggle' },
  ],
})
