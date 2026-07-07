import { useEffect, useMemo, useRef, useState } from 'react'
import Close from '@mui/icons-material/Close'
import PushPinOutlined from '@mui/icons-material/PushPinOutlined'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import { defineFeature, mergeAttributes, Node, PopupShell, tokenVar, type EditorApi } from '../../editor'
import type { Node as PMNode, Slice } from '@tiptap/pm/model'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import { icons } from '../icons'
import { useDocumentVariables, type DocumentVariable } from './documentVariables'
import { createMergeFieldSuggestion, mergeFieldInsertContent } from './mergeFieldSuggestion'

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
            const insert = dropPoint(view.state.doc, coords.pos, slice)
            // Only claim drops landing IN inline content. At a block-level gap
            // dropPoint returns a depth-0 position where tr.insert would wrap
            // the chip in a fresh paragraph — landing it at insert+1 and
            // breaking the caret/space math below. PM's default drop handles
            // that case correctly (it just leaves the chip node-selected).
            if (insert == null || !view.state.doc.resolve(insert).parent.inlineContent) return false
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
 * Which container the panel anchors to: the SDK's own actions row, else the
 * nearest toolbar (a consumer-composed bar via renderFooter / a side panel),
 * else the bare button (item rendered loose, or tests). The panel clears the
 * WHOLE bar, whatever bar the button lives in.
 */
export function panelAnchorFor(button: HTMLElement | null): HTMLElement | null {
  return (button?.closest('.insert-dock') ??
    button?.closest('[role="toolbar"]') ??
    button) as HTMLElement | null
}

/**
 * Variables panel — opens ABOVE the insert dock, left-aligned with the `@`
 * button that toggled it. Clicking outside closes it — unless PINNED (the pin
 * button), which turns it into a persistent surface: move the caret around
 * and keep inserting. Escape and the x always close.
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
  const [query, setQuery] = useState('')
  const [pinned, setPinned] = useState(false)
  // While a chip drag is in flight, the panel steps aside: see-through AND
  // click-through (pointer-events: none), so the paper it covers stays visible
  // and remains a valid drop target — native drag hit-testing skips it.
  // MUST be applied AFTER dragstart's task finishes: Chromium ABORTS a drag
  // whose source (or an ancestor) turns non-interactive/restyled while the
  // drag is still initiating — hence the deferred setTimeout( , 0) below.
  const [dragging, setDragging] = useState(false)
  const dragAsideTimer = useRef<number | undefined>(undefined)

  // Belt and braces for the ghost-stuck failure mode: if the dragged chip
  // unmounts mid-drag (the consumer's variable list can update async), its own
  // onDragEnd never runs and the panel would stay translucent AND unclickable
  // (pointer-events: none). Any drag ending anywhere still fires dragend/drop
  // through the document — reset there, independent of the chip's survival.
  // Perf: listeners exist ONLY while a drag is in flight, and dragend/drop
  // fire once per gesture (unlike dragover) — zero steady-state cost.
  useEffect(() => {
    if (!dragging) return
    const reset = () => {
      window.clearTimeout(dragAsideTimer.current)
      setDragging(false)
    }
    document.addEventListener('dragend', reset, true)
    document.addEventListener('drop', reset, true)
    return () => {
      document.removeEventListener('dragend', reset, true)
      document.removeEventListener('drop', reset, true)
    }
  }, [dragging])
  // Popper owns positioning (its own scroll/resize listeners + viewport
  // clamping — the old ~40-line place() block). The VIRTUAL anchor mixes the
  // two rects the design needs: horizontal from the @ BUTTON (left-aligned),
  // vertical from the CONTAINER bar (the panel clears the whole bar and,
  // bottom-anchored via placement "top-*", grows UPWARD without covering it).
  const virtualAnchor = useMemo(() => {
    const container = panelAnchorFor(anchor)
    if (!anchor || !container) return null
    return {
      getBoundingClientRect: () => {
        const containerRect = container.getBoundingClientRect()
        const buttonRect = anchor.getBoundingClientRect()
        return new DOMRect(
          buttonRect.left,
          containerRect.top,
          buttonRect.width,
          containerRect.height,
        )
      },
    }
  }, [anchor])

  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? variables.filter(
        (variable) =>
          variable.label.toLowerCase().includes(needle) || variable.id.toLowerCase().includes(needle),
      )
    : variables

  return (
    // Pinned = outside clicks stop closing (Escape and the x still do); the
    // @ button is the dismissEl so toggling it doesn't close-then-reopen.
    // The drag step-aside class toggles the whole surface (the shell root).
    <PopupShell
      anchorEl={virtualAnchor}
      dismissEl={anchor}
      open
      onClose={onClose}
      surfaceClassName={`mf-panel${dragging ? ' mf-panel--drag-through' : ''}`}
      role="dialog"
      ariaLabel="Variables"
      placement="top-start"
      offset={[0, 12]}
      isOutsideClick={pinned ? () => false : undefined}
      paperProps={{
        className: 'mf-panel__card',
        sx: { border: `1px solid ${tokenVar('--editor-border')}` },
      }}
    >
      <div className="mf-panel__header">
        <strong>Variables</strong>
        <div className="mf-panel__header-actions">
          <IconButton
            className="mf-panel__pin"
            size="small"
            aria-label="Pin panel"
            aria-pressed={pinned}
            title={pinned ? 'Unpin (outside clicks close again)' : 'Pin (keep open while editing)'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPinned((value) => !value)}
          >
            <PushPinOutlined fontSize="inherit" />
          </IconButton>
          <IconButton className="mf-panel__close" size="small" aria-label="Close" onClick={onClose}>
            <Close fontSize="inherit" />
          </IconButton>
        </div>
      </div>
      <TextField
        type="search"
        className="mf-panel__search"
        placeholder="Search"
        fullWidth
        value={query}
        slotProps={{ htmlInput: { 'aria-label': 'Search variables' } }}
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
                      // The whole panel steps aside (fade + click-through) —
                      // DEFERRED past this task, or Chromium aborts the drag
                      // it's still initiating (see dragAsideTimer above).
                      dragAsideTimer.current = window.setTimeout(() => setDragging(true), 0)
                      // The source chip "lifts" while the drag is in flight.
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
                      // Fires on drop AND on cancel (Esc) — the panel returns
                      // either way. Clear the deferred step-aside too: an
                      // instantly-cancelled drag must not leave the panel
                      // ghosted after dragend already ran.
                      window.clearTimeout(dragAsideTimer.current)
                      setDragging(false)
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
    </PopupShell>
  )
}

function MergeFieldInsert({ api }: { api: EditorApi }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const variables = useDocumentVariables()
  return (
    <>
      <IconButton
        ref={buttonRef}
        className="insert-dock__btn"
        title="Variables"
        aria-label="Variables"
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        {icons.mergeField}
      </IconButton>
      {open ? (
        // The Popper portals itself to <body> (escaping the dock's stacking
        // context) — no createPortal needed here.
        <MergeFieldPanel
          anchor={buttonRef.current}
          variables={variables}
          onClose={() => {
            setOpen(false)
            api.focus() // keep the editor focused after the panel closes
          }}
          // Picking closes unless the panel is pinned (handled inside).
          onPick={(variable) => api.exec('mergeField.insert', variable)}
        />
      ) : null}
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
        .insertContent(mergeFieldInsertContent({ id: field.id, label: field.label }))
        .run()
    },
  },
  insert: [
    {
      id: 'mergeField',
      label: 'Variable',
      icon: icons.mergeField,
      render: ({ api }) => <MergeFieldInsert api={api} />,
    },
  ],
})
