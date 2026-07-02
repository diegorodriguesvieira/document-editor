import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { collectContextMenuGroups, ContextMenuView } from './EditorContextMenu'
import { createMockEditor } from '../core/createMockEditor'
import type { ContextMenuGroup, ContextMenuSection } from '../core/types'

const GROUPS: ContextMenuGroup[] = [
  {
    id: 'row',
    label: 'Row',
    items: [
      { id: 'above', label: 'Insert row above', icon: '↑', commandId: 'table.addRowBefore' },
      { id: 'del-row', label: 'Delete row', icon: '🗑', commandId: 'table.deleteRow', danger: true },
    ],
  },
  {
    id: 'table',
    items: [{ id: 'del-table', label: 'Delete table', commandId: 'table.delete', danger: true }],
  },
]

describe('<ContextMenuView />', () => {
  it('renders grouped items with a heading and runs the command on click', async () => {
    const user = userEvent.setup()
    const onRun = vi.fn()
    render(<ContextMenuView x={10} y={10} groups={GROUPS} onRun={onRun} onClose={() => {}} />)

    expect(screen.getByText('Row')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Insert row above/ })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /Delete table/ }))
    expect(onRun).toHaveBeenCalledWith('table.delete')
  })

  it('marks destructive items with the danger class', () => {
    render(<ContextMenuView x={0} y={0} groups={GROUPS} onRun={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('menuitem', { name: /Delete row/ })).toHaveClass(
      'context-menu__item--danger',
    )
  })

  it('closes on Escape and on outside click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ContextMenuView x={0} y={0} groups={GROUPS} onRun={() => {}} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('collectContextMenuGroups', () => {
  const section = (id: string, when: boolean, items: ContextMenuGroup['items']): ContextMenuSection => ({
    id,
    when: () => when,
    groups: [{ id: 'g', items }],
  })
  const fakeEditor = null as unknown as Editor

  it('shows EVERY matching section, in registration order, with namespaced group ids', () => {
    const mock = createMockEditor()
    const groups = collectContextMenuGroups(
      [
        section('table', true, [{ id: 'a', label: 'Table action', commandId: 'x' }]),
        section('skipped', false, [{ id: 'b', label: 'Hidden', commandId: 'y' }]),
        section('conditional', true, [{ id: 'c', label: 'Conditional action', commandId: 'z' }]),
      ],
      mock.api,
      fakeEditor,
    )
    expect(groups.map((g) => g.id)).toEqual(['table:g', 'conditional:g'])
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
      'Table action',
      'Conditional action',
    ])
  })

  it('drops items whose isAvailable says no, then drops groups left empty', () => {
    const mock = createMockEditor()
    const groups = collectContextMenuGroups(
      [
        section('s', true, [
          { id: 'in', label: 'Applies', commandId: 'x', isAvailable: () => true },
          { id: 'out', label: 'Does not', commandId: 'y', isAvailable: () => false },
        ]),
        section('empty', true, [{ id: 'gone', label: 'Gone', commandId: 'z', isAvailable: () => false }]),
      ],
      mock.api,
      fakeEditor,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.label)).toEqual(['Applies'])
  })
})
