import { TableKit } from '@tiptap/extension-table'
import { defineFeature } from '../../editor'

/** Tables (TableKit bundles Table + Row + Header + Cell). `resizable` installs
 *  ProseMirror's columnResizing plugin — drag handles on column borders. (Row
 *  height isn't resizable in ProseMirror tables; it follows the cell content.) */
export const TableFeature = defineFeature({
  id: 'table',
  extensions: () => [TableKit.configure({ table: { resizable: true } })],
  commands: {
    'table.insert': (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
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
  insert: [{ id: 'table', label: 'Table', icon: 'T', commandId: 'table.insert' }],
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
            { id: 'row-delete', label: 'Delete row', icon: '🗑', commandId: 'table.deleteRow', danger: true, isAvailable: (e) => e.can().deleteRow() },
          ],
        },
        {
          id: 'column',
          label: 'Column',
          items: [
            { id: 'col-left', label: 'Insert column left', icon: '←', commandId: 'table.addColumnBefore', isAvailable: (e) => e.can().addColumnBefore() },
            { id: 'col-right', label: 'Insert column right', icon: '→', commandId: 'table.addColumnAfter', isAvailable: (e) => e.can().addColumnAfter() },
            { id: 'col-delete', label: 'Delete column', icon: '🗑', commandId: 'table.deleteColumn', danger: true, isAvailable: (e) => e.can().deleteColumn() },
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
            { id: 'delete-table', label: 'Delete table', icon: '🗑', commandId: 'table.delete', danger: true, isAvailable: (e) => e.can().deleteTable() },
          ],
        },
      ],
    },
  ],
})
