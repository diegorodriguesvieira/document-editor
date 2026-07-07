import { useEffect, useState } from 'react'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import { useEscapeSurface } from '../hooks/useDismissable'
import { POPUP_CLASS } from '../base.styles'
import { tokenVar } from '../theme'
import type { ContextMenuGroup, ContextMenuSection } from '../core/types'

/**
 * Pure presentational menu — grouped actions at (x, y), on MUI's Menu: the
 * portal, viewport clamping, outside-click, Escape and scroll handling are
 * all MUI's. Kept separate from the behaviour below so it's easy to test
 * without a real editor.
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
  // MUI owns this surface's Escape (onClose 'escapeKeyDown') — older
  // useDismissable surfaces (an open region, the pinned panel) must yield.
  useEscapeSurface(true)

  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ left: x, top: y }}
      slotProps={{
        // The marker class goes on the PAPER only — a marked backdrop would
        // turn every outside click into "inside a popup" for the region gate.
        // `document-editor-popup` namespaces the SDK skin on body-portaled
        // surfaces (a page's own `.context-menu` must not collide).
        paper: {
          className: `${POPUP_CLASS} context-menu`,
          sx: {
            minWidth: 240,
            maxHeight: 'min(80vh, 520px)',
            borderRadius: '12px',
            boxShadow: tokenVar('--editor-shadow-pop'),
          },
        },
        list: { 'aria-label': 'Context menu', dense: true },
      }}
    >
      {groups.flatMap((group, gi) => [
        // A divider before an unlabelled group (e.g. "Delete table").
        gi > 0 && !group.label ? <Divider key={`${group.id}:sep`} /> : null,
        group.label ? (
          <ListSubheader key={`${group.id}:label`} disableSticky>
            {group.label}
          </ListSubheader>
        ) : null,
        ...group.items.map((item) => (
          <MenuItem
            key={item.id}
            className={
              item.danger ? 'context-menu__item context-menu__item--danger' : 'context-menu__item'
            }
            sx={
              item.danger
                ? {
                    color: tokenVar('--editor-danger'),
                    // The red hover the CSS skin used to give danger items —
                    // and the one consumer keeping --editor-danger-bg alive.
                    '&:hover': { backgroundColor: tokenVar('--editor-danger-bg') },
                  }
                : undefined
            }
            onClick={() => onRun(item.commandId)}
          >
            {item.icon ? (
              <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>{item.icon}</ListItemIcon>
            ) : null}
            {item.label}
          </MenuItem>
        )),
      ])}
    </Menu>
  )
}

interface OpenState {
  x: number
  y: number
  groups: ContextMenuGroup[]
}

/**
 * Groups shown for a right-click: EVERY section whose `when` matches contributes
 * (two features can both own the clicked spot — e.g. a table inside a
 * conditional block), in registration order, with items the click doesn't
 * support filtered out. Group ids are namespaced by section so features can't
 * collide. Pure — exported for tests.
 */
export function collectContextMenuGroups(
  sections: ContextMenuSection[],
  api: EditorApi,
  editor: Editor,
): ContextMenuGroup[] {
  return sections
    .filter((section) => section.when(api))
    .flatMap((section) =>
      section.groups.map((group) => ({
        ...group,
        id: `${section.id}:${group.id}`,
        items: group.items.filter((item) => item.isAvailable?.(editor) ?? true),
      })),
    )
    .filter((group) => group.items.length > 0)
}

/**
 * Listens for right-clicks on the editor DOM and, when the clicked spot matches
 * a feature's context-menu section (e.g. inside a table), shows {@link
 * ContextMenuView}. Auto-mounted by {@link DocumentEditor} when any feature
 * contributes a context menu.
 */
export interface EditorContextMenuProps {
  editor: Editor | null
  api: EditorApi
  sections: ContextMenuSection[]
}

export function EditorContextMenu({ editor, api, sections }: EditorContextMenuProps) {
  const [open, setOpen] = useState<OpenState | null>(null)

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    // A right-click natively moves the caret to the click point, which collapses
    // a cell/text selection before the menu even opens. Suppress that when a
    // selection exists, so the menu (e.g. Merge cells) acts on what's selected.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 2 && !editor.state.selection.empty) event.preventDefault()
    }
    const onContextMenu = (event: MouseEvent) => {
      const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (!coords) return
      // With just a caret, target the right-clicked cell so actions apply there.
      // Never touch an EXISTING selection (text range OR multi-cell) — otherwise
      // right-clicking a cell selection collapses it and "Merge cells" gets nothing.
      if (editor.state.selection.empty) {
        editor.chain().focus().setTextSelection(coords.pos).run()
      }
      const groups = collectContextMenuGroups(sections, api, editor)
      if (groups.length === 0) return
      event.preventDefault()
      setOpen({ x: event.clientX, y: event.clientY, groups })
    }
    dom.addEventListener('mousedown', onMouseDown)
    dom.addEventListener('contextmenu', onContextMenu)
    return () => {
      dom.removeEventListener('mousedown', onMouseDown)
      dom.removeEventListener('contextmenu', onContextMenu)
    }
  }, [editor, api, sections])

  if (!open) return null

  // No createPortal here — MUI's Menu portals itself.
  return (
    <ContextMenuView
      x={open.x}
      y={open.y}
      groups={open.groups}
      onRun={(commandId) => {
        api.exec(commandId)
        setOpen(null)
      }}
      onClose={() => setOpen(null)}
    />
  )
}
