import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { defineFeature, mergeAttributes, Node, useDismissable, type EditorApi } from '../../editor'
import type { Node as PMNode, Slice } from '@tiptap/pm/model'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import { useDocumentVariables, type DocumentVariable } from './documentVariables'
import { createMergeFieldSuggestion } from './mergeFieldSuggestion'

/**
 * Inline atomic node — the "chip". Pure-DOM node view (lighter than React for
 * many chips). Doesn't depend on the variable list — only the panel does.
 */
const MergeField = Node.create({
  name: 'mergeField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-merge-field'),
        renderHTML: (attributes) =>
          attributes.id ? { 'data-merge-field': attributes.id as string } : {},
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-label'),
        renderHTML: (attributes) =>
          attributes.label ? { 'data-label': attributes.label as string } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-merge-field]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = (node.attrs.label ?? node.attrs.id ?? '') as string
    return ['span', mergeAttributes(HTMLAttributes, { class: 'merge-field' }), `{{${label}}}`]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.className = 'merge-field'
      dom.contentEditable = 'false'
      const id = (node.attrs.id ?? '') as string
      const label = (node.attrs.label ?? node.attrs.id ?? '') as string
      if (id) dom.setAttribute('data-merge-field', id)
      dom.textContent = `{{${label}}}`
      return { dom }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // Dropping a chip: PM's default leaves the dropped node NODE-selected
          // (blue). We want typing to continue right away — insert the chip and
          // put the CARET immediately to its right.
          handleDrop: (view, event, slice, moved) => {
            if (moved) return false // internal drags keep PM's move semantics
            const chip = chipFromSlice(slice)
            if (!chip) return false
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (!coords) return false
            const insert = dropPoint(view.state.doc, coords.pos, slice) ?? coords.pos
            const tr = view.state.tr.insert(insert, chip.type.create(chip.attrs))
            // Trailing space + caret after it — same feel as click-insert
            // (typing isn't glued to the chip).
            tr.insertText(' ', insert + chip.nodeSize)
            tr.setSelection(TextSelection.create(tr.doc, insert + chip.nodeSize + 1))
            view.dispatch(tr.scrollIntoView())
            view.focus()
            // Subtle "landing" pop on the chip that was just dropped (CSS,
            // gated by prefers-reduced-motion). Class scoped to THIS drop —
            // load/undo recreate node views without it, nothing animates
            // spuriously.
            const dom = view.nodeDOM(insert)
            if (dom instanceof HTMLElement) {
              dom.classList.add('merge-field--dropped')
              dom.addEventListener(
                'animationend',
                () => dom.classList.remove('merge-field--dropped'),
                { once: true },
              )
            }
            return true
          },
        },
      }),
    ]
  },
})

/**
 * The single mergeField chip inside a drop payload, if that's ALL the payload
 * is (a bare chip, or a chip alone inside one paragraph — both shapes come out
 * of parsing the panel's text/html). Anything richer falls back to PM's
 * default drop. Exported for tests.
 */
export function chipFromSlice(slice: Slice): PMNode | null {
  const first = slice.content.firstChild
  if (!first || slice.content.childCount !== 1) return null
  if (first.type.name === 'mergeField') return first
  if (first.type.name === 'paragraph' && first.childCount === 1) {
    const inner = first.firstChild
    if (inner?.type.name === 'mergeField') return inner
  }
  return null
}

/**
 * The drag payload IS the chip's HTML serialization: ProseMirror handles
 * `text/html` drops natively (position mapping + schema parse — the same
 * pipeline as paste), and `span[data-merge-field]` already has a parse rule.
 * So dragging a variable from the panel onto the page needs NO drop handler
 * anywhere. Built via DOM so ids/labels are attribute-escaped correctly.
 */
export function mergeFieldDragHTML(variable: DocumentVariable): string {
  const span = document.createElement('span')
  span.setAttribute('data-merge-field', variable.id)
  span.setAttribute('data-label', variable.label)
  span.textContent = `{{${variable.label}}}`
  return span.outerHTML
}

function groupVariables(variables: DocumentVariable[]): Array<[string, DocumentVariable[]]> {
  const groups = new Map<string, DocumentVariable[]>()
  for (const variable of variables) {
    const key = variable.group ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(variable)
  }
  return [...groups.entries()]
}

/**
 * Side panel anchored to the RIGHT of the insert rail (top-aligned with it).
 * Clicking outside closes it — unless PINNED (the P button), which turns it
 * into a persistent surface: move the caret around and keep inserting.
 * Escape and the x always close.
 */
function MergeFieldPanel({
  anchor,
  variables,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null
  variables: DocumentVariable[]
  onPick: (variable: DocumentVariable) => void
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [pinned, setPinned] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  // The anchor (@ button) counts as "inside" so toggling it doesn't
  // close-then-instantly-reopen. Pinned: outside clicks stop closing
  // (Escape and the x still do).
  const anchorRef = useRef<HTMLElement | null>(anchor)
  anchorRef.current = anchor
  useDismissable([cardRef, anchorRef], onClose, {
    isOutsideClick: pinned ? () => false : undefined,
  })

  // Align with the rail: top = rail top, left = just past the rail. The rail
  // is sticky, but its rect still moves before the sticky engages — track it.
  useLayoutEffect(() => {
    // Preferred anchor: the rail (top-aligned). Fallback: the button itself
    // (e.g. the item rendered outside a rail, or in tests).
    const target = anchor?.closest('.document-editor__rail') ?? anchor
    const place = () => {
      if (!target) {
        setPosition({ top: 16, left: 16 })
        return
      }
      const rect = target.getBoundingClientRect()
      setPosition({ top: rect.top, left: rect.right + 12 })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? variables.filter(
        (variable) =>
          variable.label.toLowerCase().includes(needle) || variable.id.toLowerCase().includes(needle),
      )
    : variables

  if (!position) return null
  return (
    <div
      ref={cardRef}
      className="document-editor-popup mf-panel"
      role="dialog"
      aria-label="Variables"
      style={{ top: position.top, left: position.left }}
    >
      <div className="mf-panel__header">
        <strong>Variables</strong>
        <div className="mf-panel__header-actions">
          <button
            type="button"
            className="mf-panel__pin"
            aria-label="Pin panel"
            aria-pressed={pinned}
            title={pinned ? 'Unpin (outside clicks close again)' : 'Pin (keep open while editing)'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPinned((value) => !value)}
          >
            P
          </button>
          <button type="button" className="mf-panel__close" aria-label="Close" onClick={onClose}>
            x
          </button>
        </div>
      </div>
      <input
        type="search"
        className="mf-panel__search"
        placeholder="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="mf-panel__body">
        {variables.length === 0 ? (
          <span className="mf-panel__empty">Loading variables…</span>
        ) : filtered.length === 0 ? (
          <span className="mf-panel__empty">No variable matches “{query}”</span>
        ) : (
          groupVariables(filtered).map(([group, items]) => (
            <div key={group || 'ungrouped'} className="mf-panel__group">
              {group ? <div className="mf-panel__group-label">{group}</div> : null}
              <div className="mf-panel__chips">
                {items.map((variable) => (
                  <button
                    key={variable.id}
                    type="button"
                    className="mf-chip"
                    // Drag onto the page: PM parses the text/html payload
                    // natively, so this is the whole drag side of the story.
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/html', mergeFieldDragHTML(variable))
                      event.dataTransfer.setData('text/plain', `{{${variable.label}}}`)
                      event.dataTransfer.effectAllowed = 'copy' // dragging never "spends" the chip
                      // "Lift" the source chip while the drag is in flight.
                      event.currentTarget.classList.add('mf-chip--dragging')
                      // Carry the DOCUMENT chip ({{label}}) as the drag image,
                      // not a screenshot of the panel button — you drag what
                      // you're about to drop. jsdom has no setDragImage: guard.
                      if (typeof event.dataTransfer.setDragImage === 'function') {
                        const ghost = document.createElement('span')
                        ghost.className = 'mf-drag-ghost'
                        ghost.textContent = `{{${variable.label}}}`
                        document.body.appendChild(ghost)
                        event.dataTransfer.setDragImage(ghost, 12, 12)
                        // The browser snapshots the ghost at dragstart; it can
                        // leave the DOM on the next frame.
                        requestAnimationFrame(() => ghost.remove())
                      }
                    }}
                    onDragEnd={(event) => {
                      event.currentTarget.classList.remove('mf-chip--dragging')
                    }}
                    // NO onMouseDown preventDefault here: in Chromium that
                    // BLOCKS native drag initiation (dragstart never fires).
                    // Click-insert doesn't need it — the insert command's
                    // chain().focus() restores the editor focus, and the caret
                    // position survives the button's momentary focus grab.
                    // Menu semantics: picking inserts AND closes — unless
                    // pinned, which keeps it open for several inserts.
                    onClick={() => {
                      onPick(variable)
                      if (!pinned) onClose()
                    }}
                  >
                    {variable.label}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function MergeFieldInsert({ api }: { api: EditorApi }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const variables = useDocumentVariables()
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="insert-rail__btn"
        title="Variables"
        aria-label="Variables"
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        @
      </button>
      {open
        ? // Portal to <body> so the fixed panel escapes the sticky insert-rail's
          // stacking context (otherwise it paints behind the page).
          createPortal(
            <MergeFieldPanel
              anchor={buttonRef.current}
              variables={variables}
              onClose={() => {
                setOpen(false)
                api.focus() // keep the editor focused after the panel closes
              }}
              // Picking closes unless the panel is pinned (handled inside).
              onPick={(variable) => api.exec('mergeField.insert', variable)}
            />,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * Static "team" feature: @-menu that inserts inline merge-field chips. The
 * variable list comes from {@link DocumentVariablesProvider} (consumer-owned),
 * so it can load async without touching the editor.
 */
export const MergeFieldFeature = defineFeature({
  id: 'mergeField',
  // The node (chip) + the `@` typing trigger that inserts it.
  extensions: () => [MergeField, createMergeFieldSuggestion()],
  commands: {
    'mergeField.insert': (editor, payload) => {
      const field = (payload ?? {}) as { id?: string; label?: string }
      if (!field.id) return false
      return editor
        .chain()
        .focus()
        .insertContent([
          { type: 'mergeField', attrs: { id: field.id, label: field.label ?? field.id } },
          // Always a trailing space so the cursor isn't glued to the chip.
          { type: 'text', text: ' ' },
        ])
        .run()
    },
  },
  insert: [
    {
      id: 'mergeField',
      label: 'Variable',
      icon: '@',
      render: ({ api }) => <MergeFieldInsert api={api} />,
    },
  ],
})
