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

  it('gates menu items by current applicability (via editor.can)', () => {
    const { editor } = withTable() // 3x3, caret in a plain cell
    const items = TableFeature.contextMenu![0].groups.flatMap((group) => group.items)
    const byId = (id: string) => items.find((item) => item.id === id)!

    // A plain cell isn't merged and there's no multi-cell selection.
    expect(byId('split').isAvailable!(editor)).toBe(false)
    expect(byId('merge').isAvailable!(editor)).toBe(false)
    // Structural actions apply anywhere inside the table.
    expect(byId('row-above').isAvailable!(editor)).toBe(true)
    expect(byId('delete-table').isAvailable!(editor)).toBe(true)
  })
})
