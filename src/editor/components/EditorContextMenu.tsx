import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import type { ContextMenuGroup, ContextMenuSection } from '../core/types'

/**
 * Pure presentational menu — a card of grouped actions at (x, y). Kept separate
 * from the behaviour below so it's easy to test without a real editor.
 */
export function ContextMenuView({
  x,
  y,
  groups,
  onRun,
  onClose,
}: {
  x: number
  y: number
  groups: ContextMenuGroup[]
  onRun: (commandId: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the menu inside the viewport (the page can be zoomed/scrolled).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // Capture so an outside click closes before ProseMirror handles it.
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="Context menu"
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 1100 }}
    >
      {groups.map((group, gi) => (
        <div key={group.id} className="context-menu__group">
          {/* A divider before an unlabelled group (e.g. "Excluir tabela"). */}
          {gi > 0 && !group.label ? <div className="context-menu__sep" role="separator" /> : null}
          {group.label ? <div className="context-menu__heading">{group.label}</div> : null}
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={
                item.danger
                  ? 'context-menu__item context-menu__item--danger'
                  : 'context-menu__item'
              }
              onMouseDown={(event) => {
                event.preventDefault()
                onRun(item.commandId)
              }}
            >
              {item.icon ? <span className="context-menu__icon">{item.icon}</span> : null}
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

interface OpenState {
  x: number
  y: number
  groups: ContextMenuGroup[]
}

/**
 * Listens for right-clicks on the editor DOM and, when the clicked spot matches
 * a feature's context-menu section (e.g. inside a table), shows {@link
 * ContextMenuView}. Auto-mounted by {@link DocumentEditor} when any feature
 * contributes a context menu.
 */
export function EditorContextMenu({
  editor,
  api,
  sections,
}: {
  editor: Editor | null
  api: EditorApi
  sections: ContextMenuSection[]
}) {
  const [open, setOpen] = useState<OpenState | null>(null)

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onContextMenu = (event: MouseEvent) => {
      const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (!coords) return
      // Target the right-clicked spot — unless a (multi-cell) selection already
      // covers it, which we keep so "Merge cells" still sees every cell.
      const { from, to } = editor.state.selection
      if (coords.pos < from || coords.pos > to) {
        editor.chain().focus().setTextSelection(coords.pos).run()
      }
      const section = sections.find((candidate) => candidate.when(api))
      if (!section) return
      event.preventDefault()
      setOpen({ x: event.clientX, y: event.clientY, groups: section.groups })
    }
    dom.addEventListener('contextmenu', onContextMenu)
    return () => dom.removeEventListener('contextmenu', onContextMenu)
  }, [editor, api, sections])

  if (!open) return null

  return createPortal(
    <ContextMenuView
      x={open.x}
      y={open.y}
      groups={open.groups}
      onRun={(commandId) => {
        api.exec(commandId)
        setOpen(null)
      }}
      onClose={() => setOpen(null)}
    />,
    document.body,
  )
}
