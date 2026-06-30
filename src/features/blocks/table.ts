import { TableKit } from '@tiptap/extension-table'
import { defineFeature } from '../../editor'

/** Tables (TableKit bundles Table + Row + Header + Cell). */
export const TableFeature = defineFeature({
  id: 'table',
  extensions: () => [TableKit],
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
  insert: [{ id: 'table', label: 'Tabela', icon: 'T', commandId: 'table.insert' }],
  // Right-click inside a table → row/column/cell actions. Shown only when the
  // caret (set to the clicked cell) is in a table.
  contextMenu: [
    {
      id: 'table',
      when: (state) => state.isActive('table'),
      groups: [
        {
          id: 'row',
          label: 'Linha',
          items: [
            { id: 'row-above', label: 'Inserir linha acima', icon: '↑', commandId: 'table.addRowBefore' },
            { id: 'row-below', label: 'Inserir linha abaixo', icon: '↓', commandId: 'table.addRowAfter' },
            { id: 'row-delete', label: 'Excluir linha', icon: '🗑', commandId: 'table.deleteRow', danger: true },
          ],
        },
        {
          id: 'column',
          label: 'Coluna',
          items: [
            { id: 'col-left', label: 'Inserir coluna à esquerda', icon: '←', commandId: 'table.addColumnBefore' },
            { id: 'col-right', label: 'Inserir coluna à direita', icon: '→', commandId: 'table.addColumnAfter' },
            { id: 'col-delete', label: 'Excluir coluna', icon: '🗑', commandId: 'table.deleteColumn', danger: true },
          ],
        },
        {
          id: 'cell',
          label: 'Célula',
          items: [
            { id: 'merge', label: 'Mesclar células', icon: '⧉', commandId: 'table.mergeCells' },
            { id: 'split', label: 'Dividir célula', icon: '⊟', commandId: 'table.splitCell' },
            { id: 'header', label: 'Alternar cabeçalho', icon: '▦', commandId: 'table.toggleHeaderRow' },
          ],
        },
        {
          id: 'table',
          items: [
            { id: 'delete-table', label: 'Excluir tabela', icon: '🗑', commandId: 'table.delete', danger: true },
          ],
        },
      ],
    },
  ],
})
