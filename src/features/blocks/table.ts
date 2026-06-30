import { TableKit } from '@tiptap/extension-table'
import { defineFeature } from '../../editor'

/** Tables (TableKit bundles Table + Row + Header + Cell). */
export const TableFeature = defineFeature({
  id: 'table',
  extensions: () => [TableKit],
  commands: {
    'table.insert': (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  insert: [{ id: 'table', label: 'Tabela', icon: 'T', commandId: 'table.insert' }],
})
