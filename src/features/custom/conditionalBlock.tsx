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
import { GapCursor } from '@tiptap/pm/gapcursor'
import { type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { useDocumentVariables, type DocumentVariable } from './documentVariables'

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
  /** How many entries `params` takes for this operator (CONDITION-FORMAT.md §2.2). */
  arity: 1 | 2
}

/**
 * Operators the backend evaluates. The `id`s are protocol constants of the
 * `data-condition` contract (CONDITION-FORMAT.md) — stable, do not rename.
 */
const CONDITIONS = [
  { id: 'EXISTS', label: 'is in the document', arity: 1 },
  { id: 'NOT_EXISTS', label: 'is not in the document', arity: 1 },
  { id: 'EQUALS', label: 'is equal to', arity: 2 },
  { id: 'NOT_EQUALS', label: 'is not equal to', arity: 2 },
  { id: 'GREATER_THAN', label: 'is greater than', arity: 2 },
  { id: 'LESS_THAN', label: 'is less than', arity: 2 },
] as const satisfies readonly ConditionOption[]

/** The condition operators as a typed set — shareable as the backend contract. */
export type ConditionId = (typeof CONDITIONS)[number]['id']

/** Operator → arity. A leaf is well-formed when `params.length` matches. */
export const CONDITION_SIGNATURES = Object.fromEntries(
  CONDITIONS.map((option) => [option.id, option.arity]),
) as Record<ConditionId, number>

/** A comparison operand: a document-variable reference, or a raw typed value. */
export type ConditionOperand =
  | { type: 'variable'; ref: string }
  | { type: 'literal'; value: string | number | boolean }

/** One comparison. `null` holes are draft state (author mid-edit). */
export interface ConditionLeaf {
  op: ConditionId | null
  params: (ConditionOperand | null)[]
}

/** The `condition` attr: an all/any tree of comparisons (CONDITION-FORMAT.md). */
export type Condition = { all: Condition[] } | { any: Condition[] } | ConditionLeaf

/** What a freshly inserted block carries: one empty comparison (a draft). */
const DRAFT_CONDITION: Condition = { all: [{ op: null, params: [null, null] }] }

// Paste/setJSON can carry arbitrary attr JSON — cap what the shape guard
// accepts (mirrors the backend validator caps, CONDITION-FORMAT.md §4).
const MAX_CONDITION_DEPTH = 10
const MAX_CONDITION_LEAVES = 50

function isOperandShape(value: unknown): value is ConditionOperand | null {
  if (value === null) return true
  if (typeof value !== 'object') return false
  const operand = value as Record<string, unknown>
  if (operand.type === 'variable') return typeof operand.ref === 'string'
  if (operand.type === 'literal') {
    const type = typeof operand.value
    // Finite only: Infinity/NaN aren't JSON — they'd stringify to null in
    // data-condition and fail the backend validator after the publish gate.
    return type === 'string' || type === 'boolean' || (type === 'number' && Number.isFinite(operand.value))
  }
  return false
}

/** Structural check — drafts pass. Completeness is isCompleteCondition's job. */
function isConditionShape(value: unknown, depth = 0, state = { leaves: 0 }): value is Condition {
  if (depth > MAX_CONDITION_DEPTH) return false
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  // Exactly one of the three forms — never all+any, never combinator+op (§2.1).
  const forms =
    ('all' in node ? 1 : 0) + ('any' in node ? 1 : 0) + ('op' in node || 'params' in node ? 1 : 0)
  if (forms !== 1) return false
  if ('all' in node || 'any' in node) {
    const children = 'all' in node ? node.all : node.any
    return (
      Array.isArray(children) &&
      children.length > 0 &&
      children.every((child) => isConditionShape(child, depth + 1, state))
    )
  }
  if (++state.leaves > MAX_CONDITION_LEAVES) return false
  // Object.hasOwn, not `in`: document-derived ops must not reach the prototype
  // chain ("toString" is not an operator).
  if (
    node.op != null &&
    !(typeof node.op === 'string' && Object.hasOwn(CONDITION_SIGNATURES, node.op))
  )
    return false
  return (
    Array.isArray(node.params) &&
    node.params.every(isOperandShape) &&
    // Params must match the arity — a wrong-length leaf is uneditable by the
    // form (writes past params.length are dropped, so an empty-params draft
    // would silently swallow the variable pick). Drafts hold 1–2 slots.
    (node.op == null
      ? node.params.length >= 1 && node.params.length <= 2
      : node.params.length === CONDITION_SIGNATURES[node.op as ConditionId])
  )
}

/**
 * True when the author finished the condition (valid shape, no draft holes,
 * arity respected). The publish gate consumers call before sending a document
 * to the backend — see CONDITION-FORMAT.md §5.
 */
export function isCompleteCondition(value: unknown): boolean {
  if (!isConditionShape(value)) return false
  const complete = (cond: Condition): boolean => {
    if ('all' in cond) return cond.all.every(complete)
    if ('any' in cond) return cond.any.every(complete)
    return (
      cond.op != null &&
      cond.params.length === CONDITION_SIGNATURES[cond.op] &&
      cond.params.every((p) => p != null && (p.type !== 'variable' || p.ref !== ''))
    )
  }
  return complete(value)
}

/** data-condition="<JSON>" → Condition; anything malformed degrades to a draft. */
function parseConditionAttr(raw: string | null): Condition {
  if (!raw) return DRAFT_CONDITION
  try {
    const parsed: unknown = JSON.parse(raw)
    return isConditionShape(parsed) ? parsed : DRAFT_CONDITION
  } catch {
    return DRAFT_CONDITION
  }
}

/** The single comparison the flat form can edit: `{all: [leaf]}` or a bare
 * leaf. Multi-condition/any trees (authored outside the UI) return null — the
 * form must not render fields that would destroy them on the next change. */
function editableLeaf(cond: Condition): ConditionLeaf | null {
  if ('all' in cond) return cond.all.length === 1 ? editableLeaf(cond.all[0]) : null
  if ('any' in cond) return null
  return cond
}

const withParam = (
  params: (ConditionOperand | null)[],
  index: number,
  operand: ConditionOperand | null,
) => params.map((p, i) => (i === index ? operand : p))

// CONDITION-FORMAT.md §2.4: a valid JSON number after trim. Anything else
// stays a string literal (leading zeros, "1.2.3", free text…).
const NUMBER_LIKE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/

/** Text input → literal operand. Numeric-looking input becomes a JSON number
 * so GREATER_THAN/LESS_THAN compare numerically on the backend. Overflow to
 * Infinity (e.g. "1e999") isn't JSON — those stay strings. */
function literalFromInput(text: string): ConditionOperand | null {
  if (text === '') return null
  const trimmed = text.trim()
  const num = NUMBER_LIKE.test(trimmed) ? Number(trimmed) : NaN
  return { type: 'literal', value: Number.isFinite(num) ? num : text }
}

/** The literal face of the right-hand operand. Holds the RAW text locally —
 * controlling the input from the re-parsed literal would canonicalize while
 * typing ("1.50" → "1.5", eating keystrokes). Remounts (op/face switch,
 * panel reopen) re-seed it from the stored literal. */
function LiteralValueInput({ initial, onCommit }: { initial: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(initial)
  return (
    <input
      aria-label="Value"
      type="text"
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        onCommit(event.target.value)
      }}
    />
  )
}

/** Pure, testable condition editor (no editor dependency). Edits the single
 * comparison of the canonical `{all: [leaf]}` shape the UI produces today. */
export function ConditionEditor({
  variables,
  value,
  onChange,
  onDone,
}: {
  variables: DocumentVariable[]
  value: Condition
  onChange: (next: Condition) => void
  onDone: () => void
}) {
  const leaf = editableLeaf(value)
  const right = leaf?.params[1] ?? null
  // Which face the right-hand operand shows while it's still null (draft).
  // With an operand present, the face is DERIVED from the data — local state
  // would go stale under undo/external changes while the panel is open.
  const [draftRightType, setDraftRightType] = useState<'literal' | 'variable'>(
    right?.type === 'variable' ? 'variable' : 'literal',
  )
  const rightType = right?.type ?? draftRightType
  if (!leaf) {
    return (
      <div className="cond-editor">
        <p className="cond-editor__complex">
          This block carries a multi-condition rule authored outside this editor — it can’t be
          edited here without losing structure.
        </p>
        <button type="button" className="cond-editor__done" onClick={onDone}>
          Done
        </button>
      </div>
    )
  }

  const option = CONDITIONS.find((c) => c.id === leaf.op)
  const left = leaf.params[0] ?? null
  // Always emit the canonical shape; never mutate — PM history shares attr refs.
  const commit = (next: ConditionLeaf) => onChange({ all: [next] })

  const setOp = (id: string) => {
    const op = (id || null) as ConditionId | null
    // Resize params to the operator's arity, keeping what's already filled.
    const arity = op ? CONDITION_SIGNATURES[op] : 2
    commit({ op, params: Array.from({ length: arity }, (_, i) => leaf.params[i] ?? null) })
  }

  return (
    <div className="cond-editor">
      <label className="cond-editor__field">
        <span>Variable</span>
        <select
          aria-label="Variable"
          value={left?.type === 'variable' ? left.ref : ''}
          onChange={(event) =>
            commit({
              ...leaf,
              params: withParam(
                leaf.params,
                0,
                event.target.value ? { type: 'variable', ref: event.target.value } : null,
              ),
            })
          }
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
          value={leaf.op ?? ''}
          onChange={(event) => setOp(event.target.value)}
        >
          <option value="">Select a condition *</option>
          {CONDITIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {option?.arity === 2 ? (
        <>
          <label className="cond-editor__field">
            <span>Compare with</span>
            <select
              aria-label="Compare with"
              value={rightType}
              onChange={(event) => {
                setDraftRightType(event.target.value as 'literal' | 'variable')
                // The old operand belongs to the other face — clear it.
                commit({ ...leaf, params: withParam(leaf.params, 1, null) })
              }}
            >
              <option value="literal">a value</option>
              <option value="variable">a variable</option>
            </select>
          </label>
          {rightType === 'variable' ? (
            <label className="cond-editor__field">
              <span>Variable</span>
              <select
                aria-label="Comparison variable"
                value={right?.type === 'variable' ? right.ref : ''}
                onChange={(event) =>
                  commit({
                    ...leaf,
                    params: withParam(
                      leaf.params,
                      1,
                      event.target.value ? { type: 'variable', ref: event.target.value } : null,
                    ),
                  })
                }
              >
                <option value="">Select a variable *</option>
                {variables.map((variable) => (
                  <option key={variable.id} value={variable.id}>
                    {variable.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="cond-editor__field">
              <span>Value</span>
              <LiteralValueInput
                initial={right?.type === 'literal' ? String(right.value) : ''}
                onCommit={(text) =>
                  commit({ ...leaf, params: withParam(leaf.params, 1, literalFromInput(text)) })
                }
              />
            </label>
          )}
        </>
      ) : null}

      <button type="button" className="cond-editor__done" onClick={onDone}>
        Done
      </button>
    </div>
  )
}

function operandText(operand: ConditionOperand | null, variables: DocumentVariable[]): string {
  if (!operand) return '…'
  if (operand.type === 'variable')
    return variables.find((v) => v.id === operand.ref)?.label ?? operand.ref
  return String(operand.value)
}

function conditionText(cond: Condition, variables: DocumentVariable[]): string {
  if ('all' in cond || 'any' in cond) {
    const children = 'all' in cond ? cond.all : cond.any
    const joiner = 'all' in cond ? ' and ' : ' or '
    return (
      children
        .map((child) => {
          const text = conditionText(child, variables)
          return 'all' in child || 'any' in child ? `(${text})` : text
        })
        .join(joiner) || 'no condition'
    )
  }
  const option = CONDITIONS.find((c) => c.id === cond.op)
  if (!option || !cond.params[0]) return 'no condition'
  const left = operandText(cond.params[0], variables)
  const rest = option.arity === 2 ? ` ${operandText(cond.params[1] ?? null, variables)}` : ''
  return `${left} ${option.label}${rest}`
}

function ConditionalBlockView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const variables = useDocumentVariables()
  const [editing, setEditing] = useState(false)
  // setJSON doesn't go through parseHTML — guard the attr shape here too.
  const raw: unknown = node.attrs.condition
  const cond: Condition = isConditionShape(raw) ? raw : DRAFT_CONDITION

  // Disable "add nested" once this block is already at the depth cap. getPos can
  // be briefly stale/undefined while the view unmounts, so guard the resolve.
  let atDepthLimit = true
  const selfPos = typeof getPos === 'function' ? getPos() : null
  if (selfPos != null) {
    try {
      atDepthLimit = conditionalDepthAt(editor.state.doc.resolve(selfPos + 1)) >= MAX_CONDITIONAL_DEPTH
    } catch {
      atDepthLimit = true
    }
  }
  const addNested = () => {
    // Read the position fresh — the render-time one can be stale if the node moved.
    if (typeof getPos !== 'function') return
    const at = getPos()
    const self = at == null ? null : editor.state.doc.nodeAt(at)
    if (at == null || !self) return
    // Append a NEW empty nested conditional as the last child, so existing content
    // (e.g. text above) stays put — instead of wrapping it into the nested block.
    // If the block currently ENDS in an empty paragraph (e.g. it was just created),
    // the nested block replaces that line instead of leaving a blank line above.
    // Focus lands INSIDE the new nested block, ready to type its content; the
    // gap cursor (arrows ↑/↓) still reaches the gaps above/below it.
    const contentEnd = at + self.nodeSize - 1
    const last = self.lastChild
    const trailingEmptyLine = last != null && last.isTextblock && last.content.size === 0
    const insertAt = trailingEmptyLine ? contentEnd - last.nodeSize : contentEnd
    editor
      .chain()
      .insertContentAt(
        trailingEmptyLine ? { from: insertAt, to: contentEnd } : insertAt,
        { type: 'conditionalBlock', content: [{ type: 'paragraph' }] },
      )
      // insertAt+1 = the nested block's empty paragraph; +2 = the caret spot in it.
      .focus(insertAt + 2)
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
            <span className="conditional-block__cond">{conditionText(cond, variables)}</span>
          </button>
          <button
            type="button"
            className="conditional-block__nest"
            aria-label="Add nested condition"
            title="Nest a condition (AND)"
            disabled={atDepthLimit}
            onMouseDown={(event) => event.preventDefault()}
            onClick={addNested}
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
            onChange={(next) => updateAttributes({ condition: next })}
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
  // condition the backend evaluates to gate the content.
  isolating: true,

  addAttributes() {
    return {
      condition: {
        default: DRAFT_CONDITION,
        parseHTML: (element) => parseConditionAttr(element.getAttribute('data-condition')),
        renderHTML: (attributes) => ({
          // JSON.stringify is mandatory: PM's DOMSerializer does a raw
          // setAttribute — an object would render as "[object Object]".
          'data-condition': JSON.stringify(attributes.condition ?? DRAFT_CONDITION),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-conditional-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // The backend reads data-condition (the condition JSON — grammar, coercion
    // and error policy in CONDITION-FORMAT.md) + content, evaluates it, and
    // includes/excludes the block when rendering the PDF.
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-conditional-block': '', class: 'conditional-block' }),
      0,
    ]
  },

  addKeyboardShortcuts() {
    // An EMPTY line inside a conditional, next to an isolating block (a nested
    // conditional), can't be removed by the default commands: Backspace can't
    // join/lift across the isolating boundary and Delete can't merge into the
    // nested block — every key is a no-op and the line is stuck. So the feature
    // handles it: remove the empty line (never the block's last one — the
    // schema needs block+) and leave the gap cursor where it was.
    const removeEmptyLine = () => {
      const { $from, empty } = this.editor.state.selection
      if (!empty || !$from.parent.isTextblock || $from.parent.content.size > 0) return false
      if ($from.node(-1).type.name !== this.name) return false
      if ($from.node(-1).childCount <= 1) return false
      const from = $from.before()
      const to = $from.after()
      return this.editor.commands.command(({ tr, dispatch }) => {
        if (dispatch) {
          tr.delete(from, to)
          const $gap = tr.doc.resolve(from)
          // `valid` exists at runtime but is missing from the typings.
          const gapOk = (GapCursor as unknown as { valid: (pos: ResolvedPos) => boolean }).valid($gap)
          tr.setSelection(gapOk ? new GapCursor($gap) : Selection.near($gap, -1))
        }
        return true
      })
    }
    return { Backspace: removeEmptyLine, Delete: removeEmptyLine }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConditionalBlockView)
  },
})

/**
 * Backstop for the nesting cap: rejects any transaction whose result would nest a
 * conditionalBlock deeper than MAX_CONDITIONAL_DEPTH. `conditional.wrap` and the
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
 * "Team" feature: wrap a block in a conditional block whose condition (an
 * all/any tree of typed comparisons — CONDITION-FORMAT.md) the backend
 * evaluates at render time. Variables come from
 * {@link DocumentVariablesProvider} (shared with merge fields).
 */
export const ConditionalBlockFeature = defineFeature({
  id: 'conditionalBlock',
  extensions: () => [ConditionalBlock, ConditionalDepthGuard],
  commands: {
    // Wrap the current block in a conditional — a top-level one, or a nested one
    // (= AND) when the caret is already inside a conditional. Capped at
    // MAX_CONDITIONAL_DEPTH; removal is via the block's trash button.
    'conditional.wrap': (editor) => {
      if (conditionalDepthAt(editor.state.selection.$from) >= MAX_CONDITIONAL_DEPTH) return false
      return editor.chain().focus().wrapIn('conditionalBlock').run()
    },
  },
  // Mod-Alt-b ("block"): Mod-Shift-k is Firefox's Web Console.
  keymap: { 'Mod-Alt-b': 'conditional.wrap' },
  insert: [{ id: 'conditional', label: 'Conditional block', icon: '⑂', commandId: 'conditional.wrap' }],
})
