import { useRef, useState } from 'react'
import IconButton from '@mui/material/IconButton'
import { getHTMLFromFragment, type Editor } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import { TextSelection } from '@tiptap/pm/state'
import { defineFeature, PopupShell, useFeatureState, type FeatureRenderContext } from '../../editor'
import { popupTriggerProps } from '../promptForms'
import { icons } from '../icons'

const TABLE_COLUMN_OPTIONS = [1, 2, 3, 4]

/**
 * True when converting the current selection into a table would nest a table
 * inside a table cell — either the selection already contains one (e.g. a
 * broad "select all" swept up an existing table), or the caret already sits
 * inside a table (the new table would nest inside that cell). Nesting is
 * schema-legal here (`table`'s node spec is `group: 'block'`, and
 * `tableCell`/`tableHeader` accept `block+`), so nothing stops it at the
 * schema level — this is a deliberate product guard on top.
 */
function selectionBlocksTableColumns(editor: Editor): boolean {
  const { selection } = editor.state
  if (selection.empty || editor.isActive('table')) return true
  let hasTable = false
  selection.content().content.descendants((node) => {
    if (node.type.name === 'table') hasTable = true
    return !hasTable
  })
  return hasTable
}

/**
 * The bubble's "Table columns" button: pick 1–4 and a table of that width
 * replaces the selection — a blank header row on top, and the selected text
 * (formatting intact) in the first cell of the data row below it. A
 * `PopupShell` menu of plain options — same shape as `ColorControl`'s swatch
 * grid, just a vertical list of labels instead of colors.
 */
function TableColumnsControl({ editor, api }: FeatureRenderContext) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // No live editor (mock/headless rendering) → nothing to gate on yet.
  const disabled = useFeatureState(editor, selectionBlocksTableColumns) ?? false

  const pick = (cols: number) => {
    api.exec('table.insertColumns', { cols })
    setOpen(false)
  }

  return (
    <>
      <IconButton
        ref={buttonRef}
        disabled={disabled}
        {...popupTriggerProps('Table columns', open, () => setOpen((value) => !value), 'menu')}
      >
        {icons.tableColumns}
      </IconButton>
      <PopupShell
        anchorEl={buttonRef.current}
        open={open}
        onClose={() => setOpen(false)}
        surfaceClassName="table-columns-picker"
        role="menu"
        ariaLabel="Table columns"
        popperProps={{ onMouseDown: (event) => event.preventDefault() }}
      >
        <div className="table-columns-picker__list">
          {TABLE_COLUMN_OPTIONS.map((cols) => (
            <button
              key={cols}
              type="button"
              className="table-columns-picker__option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(cols)}
            >
              {cols} {cols === 1 ? 'column' : 'columns'}
            </button>
          ))}
        </div>
      </PopupShell>
    </>
  )
}

/** Tables (TableKit bundles Table + Row + Header + Cell). `resizable` installs
 *  ProseMirror's columnResizing plugin — drag handles on column borders. (Row
 *  height isn't resizable in ProseMirror tables; it follows the cell content.) */
export const TableFeature = defineFeature({
  id: 'table',
  extensions: () => [TableKit.configure({ table: { resizable: true } })],
  commands: {
    'table.insert': (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    // Replaces the selection with a 2-row table of the chosen width (1–4
    // cols): a blank header row on top, and the selected content (marks
    // intact) in the first cell of a plain data row underneath.
    'table.insertColumns': (editor, payload) => {
      const cols = Number((payload as { cols?: number } | undefined)?.cols)
      if (!Number.isInteger(cols) || cols < 1 || cols > 4) return false
      if (selectionBlocksTableColumns(editor)) return false

      const { selection, schema } = editor.state
      const html = selection.empty
        ? null
        : getHTMLFromFragment(selection.content().content, schema)

      const chain = editor.chain().focus().insertTable({ rows: 2, cols, withHeaderRow: true })
      if (!html) return chain.run()

      return chain
        .command(({ tr }) => {
          // insertTable's own selection lands inside the (blank) header row —
          // walk up to the table node we just created and move the caret
          // into the data row below it, so `insertContent` lands there
          // instead and the header stays empty.
          const $from = tr.selection.$from
          let tablePos = -1
          for (let depth = $from.depth; depth >= 0; depth -= 1) {
            if ($from.node(depth).type.name === 'table') {
              tablePos = $from.before(depth)
              break
            }
          }
          const table = tablePos >= 0 ? tr.doc.nodeAt(tablePos) : null
          if (!table) return true

          let dataRowPos = -1
          table.forEach((_row, offset, index) => {
            if (index === 1) dataRowPos = tablePos + 1 + offset
          })
          if (dataRowPos >= 0) tr.setSelection(TextSelection.near(tr.doc.resolve(dataRowPos)))
          return true
        })
        .insertContent(html)
        .run()
    },
    'table.addRowBefore': (editor) => editor.chain().focus().addRowBefore().run(),
    'table.addRowAfter': (editor) => editor.chain().focus().addRowAfter().run(),
    'table.deleteRow': (editor) => editor.chain().focus().deleteRow().run(),
    'table.addColumnBefore': (editor) => editor.chain().focus().addColumnBefore().run(),
    'table.addColumnAfter': (editor) => editor.chain().focus().addColumnAfter().run(),
    'table.deleteColumn': (editor) => editor.chain().focus().deleteColumn().run(),
    'table.mergeCells': (editor) => editor.chain().focus().mergeCells().run(),
    'table.splitCell': (editor) => editor.chain().focus().splitCell().run(),
    'table.toggleHeaderRow': (editor) => editor.chain().focus().toggleHeaderRow().run(),
    'table.delete': (editor) => editor.chain().focus().deleteTable().run(),
  },
  // NOT Mod-Shift-t: that's the browser's own "reopen closed tab" (Chrome/
  // Firefox/Safari, both platforms) — the page never sees the keydown.
  keymap: { 'Mod-Alt-t': 'table.insert' },
  insert: [{ id: 'table', label: 'Table', icon: icons.table, commandId: 'table.insert' }],
  // Right-click inside a table → row/column/cell actions. Each item shows only
  // when it currently applies (via `editor.can()`): e.g. Merge needs a multi-cell
  // selection, Split needs a merged cell, Delete row/column hides on the last one.
  contextMenu: [
    {
      id: 'table',
      when: (state) => state.isActive('table'),
      groups: [
        {
          id: 'row',
          label: 'Row',
          items: [
            { id: 'row-above', label: 'Insert row above', icon: '↑', commandId: 'table.addRowBefore', isAvailable: (e) => e.can().addRowBefore() },
            { id: 'row-below', label: 'Insert row below', icon: '↓', commandId: 'table.addRowAfter', isAvailable: (e) => e.can().addRowAfter() },
            { id: 'row-delete', label: 'Delete row', icon: icons.delete, commandId: 'table.deleteRow', danger: true, isAvailable: (e) => e.can().deleteRow() },
          ],
        },
        {
          id: 'column',
          label: 'Column',
          items: [
            { id: 'col-left', label: 'Insert column left', icon: '←', commandId: 'table.addColumnBefore', isAvailable: (e) => e.can().addColumnBefore() },
            { id: 'col-right', label: 'Insert column right', icon: '→', commandId: 'table.addColumnAfter', isAvailable: (e) => e.can().addColumnAfter() },
            { id: 'col-delete', label: 'Delete column', icon: icons.delete, commandId: 'table.deleteColumn', danger: true, isAvailable: (e) => e.can().deleteColumn() },
          ],
        },
        {
          id: 'cell',
          label: 'Cell',
          items: [
            { id: 'merge', label: 'Merge cells', icon: '⧉', commandId: 'table.mergeCells', isAvailable: (e) => e.can().mergeCells() },
            { id: 'split', label: 'Split cell', icon: '⊟', commandId: 'table.splitCell', isAvailable: (e) => e.can().splitCell() },
            { id: 'header', label: 'Toggle header row', icon: '▦', commandId: 'table.toggleHeaderRow', isAvailable: (e) => e.can().toggleHeaderRow() },
          ],
        },
        {
          id: 'table',
          items: [
            { id: 'delete-table', label: 'Delete table', icon: icons.delete, commandId: 'table.delete', danger: true, isAvailable: (e) => e.can().deleteTable() },
          ],
        },
      ],
    },
  ],
})

/**
 * The bubble's "Table columns" quick-insert. A separate, toolbar-only
 * feature (no extensions of its own) rather than a `toolbar` entry on
 * `TableFeature`: that lets it be slotted anywhere in the app's feature
 * array — right next to `ListsFeature`, in this app's preset — without
 * disturbing `TableFeature`'s own position, which also drives the footer
 * insert-dock's "Table" button order. `dependsOn` gives a clear boot error
 * instead of a silently no-op button if it's ever enabled without `table`.
 */
export const TableColumnsFeature = defineFeature({
  id: 'tableColumns',
  dependsOn: ['table'],
  extensions: () => [],
  toolbar: [
    {
      id: 'tableColumns',
      group: 'blocks',
      label: 'Table columns',
      render: (ctx) => <TableColumnsControl {...ctx} />,
    },
  ],
})
