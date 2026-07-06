import { describe, expect, it } from 'vitest'
import { resolveFeatures, type EditorApi, type EditorStateView } from '../../editor'
import { jsonFindNode, renderEditor } from '../../test/editorHarness'
import { TableFeature } from './table'

/** Minimal EditorStateView for testing a context-menu `when` predicate. */
const stateView = (isActive: (name: string) => boolean): EditorStateView => ({
  isActive,
  canUndo: () => false,
  canRedo: () => false,
  isEmpty: () => false,
  isSelectionEmpty: () => true,
})

const rows = (api: EditorApi) => jsonFindNode(api.getJSON().doc, 'table')?.content?.length ?? 0
const cols = (api: EditorApi) => jsonFindNode(api.getJSON().doc, 'tableRow')?.content?.length ?? 0

function withTable() {
  const created = renderEditor([TableFeature])
  created.api.exec('table.insert') // 3x3 with a header row; caret lands inside
  return created
}

describe('table feature', () => {
  it('inserts a 3x3 table', () => {
    const { api } = withTable()
    expect(rows(api)).toBe(3)
    expect(cols(api)).toBe(3)
  })

  it('adds and removes rows', () => {
    const { api } = withTable()
    expect(api.exec('table.addRowAfter')).toBe(true)
    expect(rows(api)).toBe(4)
    expect(api.exec('table.deleteRow')).toBe(true)
    expect(rows(api)).toBe(3)
  })

  it('adds and removes columns', () => {
    const { api } = withTable()
    expect(api.exec('table.addColumnAfter')).toBe(true)
    expect(cols(api)).toBe(4)
    expect(api.exec('table.deleteColumn')).toBe(true)
    expect(cols(api)).toBe(3)
  })

  it('deletes the whole table', () => {
    const { api } = withTable()
    expect(jsonFindNode(api.getJSON().doc, 'table')).toBeDefined()
    expect(api.exec('table.delete')).toBe(true)
    expect(jsonFindNode(api.getJSON().doc, 'table')).toBeUndefined()
  })

  it('contributes a context menu scoped to tables, backed by real commands', () => {
    const section = TableFeature.contextMenu?.[0]
    expect(section).toBeDefined()
    // Shown only inside a table.
    expect(section!.when(stateView((name) => name === 'table'))).toBe(true)
    expect(section!.when(stateView(() => false))).toBe(false)

    // Every menu item points at a command the feature actually registers.
    const { commands } = resolveFeatures([TableFeature])
    const ids = section!.groups.flatMap((group) => group.items.map((item) => item.commandId))
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(commands[id]).toBeDefined()
  })

  it('gates EVERY menu item by current applicability (via editor.can)', () => {
    const { editor } = withTable() // 3x3, caret in a plain cell
    const items = TableFeature.contextMenu![0].groups.flatMap((group) => group.items)

    // From a plain single cell: structure applies everywhere, merge needs a
    // multi-cell selection, split needs a merged cell. The sweep runs every
    // isAvailable lambda the feature declares — no dead gates.
    const expected: Record<string, boolean> = {
      'row-above': true,
      'row-below': true,
      'row-delete': true,
      'col-left': true,
      'col-right': true,
      'col-delete': true,
      merge: false,
      split: false,
      header: true,
      'delete-table': true,
    }
    expect(items.length).toBe(Object.keys(expected).length)
    for (const item of items) {
      expect({ id: item.id, available: item.isAvailable!(editor) }).toEqual({
        id: item.id,
        available: expected[item.id],
      })
    }
  })

  it('inserts on the LEADING side too (row above / column left)', () => {
    const { api } = withTable()
    expect(api.exec('table.addRowBefore')).toBe(true)
    expect(rows(api)).toBe(4)
    expect(api.exec('table.addColumnBefore')).toBe(true)
    expect(cols(api)).toBe(4)
  })

  it('merges a real multi-cell selection and splits it back', async () => {
    const { CellSelection } = await import('@tiptap/pm/tables')
    const created = withTable()
    const { editor, api } = created

    // Select the first two cells of the SECOND row (plain cells).
    const cells: number[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos)
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[1])),
    )

    const secondRowCells = () =>
      jsonFindNode(api.getJSON().doc, 'table')?.content?.[1]?.content?.length
    expect(secondRowCells()).toBe(3)
    expect(api.exec('table.mergeCells')).toBe(true)
    expect(secondRowCells()).toBe(2) // two cells fused into one

    expect(api.exec('table.splitCell')).toBe(true)
    expect(secondRowCells()).toBe(3)
  })

  it('toggles the header row', () => {
    const { api } = withTable()
    const firstRowTypes = () =>
      jsonFindNode(api.getJSON().doc, 'tableRow')?.content?.map((cell) => cell.type)

    expect(firstRowTypes()).toEqual(['tableHeader', 'tableHeader', 'tableHeader'])
    expect(api.exec('table.toggleHeaderRow')).toBe(true)
    expect(firstRowTypes()).toEqual(['tableCell', 'tableCell', 'tableCell'])
    expect(api.exec('table.toggleHeaderRow')).toBe(true)
    expect(firstRowTypes()).toEqual(['tableHeader', 'tableHeader', 'tableHeader'])
  })
})
