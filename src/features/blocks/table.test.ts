import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { createEditor, type CreatedEditor, type EditorStateView } from '../../editor'
import { TableFeature } from './table'

/** Minimal EditorStateView for testing a context-menu `when` predicate. */
const stateView = (isActive: (name: string) => boolean): EditorStateView => ({
  isActive,
  canUndo: () => false,
  canRedo: () => false,
  isEmpty: () => false,
})

let created: CreatedEditor | undefined

afterEach(() => {
  created?.editor.destroy()
  created = undefined
})

function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

function findNode(node: JSONContent, type: string): JSONContent | null {
  if (node.type === type) return node
  for (const child of node.content ?? []) {
    const found = findNode(child, type)
    if (found) return found
  }
  return null
}

const rows = () => findNode(created!.api.getJSON().doc, 'table')?.content?.length ?? 0
const cols = () => findNode(created!.api.getJSON().doc, 'tableRow')?.content?.length ?? 0

function withTable() {
  created = createEditor({ features: [TableFeature], element: mountTarget() })
  created.api.exec('table.insert') // 3x3 with a header row; caret lands inside
  return created
}

describe('table feature', () => {
  it('inserts a 3x3 table', () => {
    withTable()
    expect(rows()).toBe(3)
    expect(cols()).toBe(3)
  })

  it('adds and removes rows', () => {
    withTable()
    expect(created!.api.exec('table.addRowAfter')).toBe(true)
    expect(rows()).toBe(4)
    expect(created!.api.exec('table.deleteRow')).toBe(true)
    expect(rows()).toBe(3)
  })

  it('adds and removes columns', () => {
    withTable()
    expect(created!.api.exec('table.addColumnAfter')).toBe(true)
    expect(cols()).toBe(4)
    expect(created!.api.exec('table.deleteColumn')).toBe(true)
    expect(cols()).toBe(3)
  })

  it('deletes the whole table', () => {
    withTable()
    expect(findNode(created!.api.getJSON().doc, 'table')).not.toBeNull()
    expect(created!.api.exec('table.delete')).toBe(true)
    expect(findNode(created!.api.getJSON().doc, 'table')).toBeNull()
  })

  it('contributes a context menu scoped to tables, backed by real commands', () => {
    const section = TableFeature.contextMenu?.[0]
    expect(section).toBeDefined()
    // Shown only inside a table.
    expect(section!.when(stateView((name) => name === 'table'))).toBe(true)
    expect(section!.when(stateView(() => false))).toBe(false)

    // Every menu item points at a command the feature actually registers.
    created = createEditor({ features: [TableFeature], element: mountTarget() })
    const ids = section!.groups.flatMap((group) => group.items.map((item) => item.commandId))
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(created.api.can(id)).toBe(true)
  })

  it('gates menu items by current applicability (via editor.can)', () => {
    withTable() // 3x3, caret in a plain cell
    const items = TableFeature.contextMenu![0].groups.flatMap((group) => group.items)
    const byId = (id: string) => items.find((item) => item.id === id)!
    const editor = created!.editor

    // A plain cell isn't merged and there's no multi-cell selection.
    expect(byId('split').isAvailable!(editor)).toBe(false)
    expect(byId('merge').isAvailable!(editor)).toBe(false)
    // Structural actions apply anywhere inside the table.
    expect(byId('row-above').isAvailable!(editor)).toBe(true)
    expect(byId('delete-table').isAvailable!(editor)).toBe(true)
  })
})
