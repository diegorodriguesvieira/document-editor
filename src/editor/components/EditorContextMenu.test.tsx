import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { collectContextMenuGroups, ContextMenuView, EditorContextMenu } from './EditorContextMenu'
import { createMockEditor } from '../core/createMockEditor'
import type { ContextMenuGroup, ContextMenuSection } from '../core/types'
import { TableFeature } from '../../features'
import { docWith, jsonFindNode, renderEditor } from '../../test/editorHarness'

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

  it('activates on CLICK, not on mousedown (keyboard path stays intact)', () => {
    const onRun = vi.fn()
    render(<ContextMenuView x={0} y={0} groups={GROUPS} onRun={onRun} onClose={() => {}} />)
    const item = screen.getByRole('menuitem', { name: /Insert row above/ })

    // mousedown alone must NOT run the command; the CLICK — which
    // Enter/Space also produce on a menuitem — is the activation. (The
    // selection survives regardless: MUI's Menu is modal, the press lands
    // above the editor.)
    fireEvent.mouseDown(item)
    expect(onRun).not.toHaveBeenCalled()
    fireEvent.click(item)
    expect(onRun).toHaveBeenCalledWith('table.addRowBefore')
  })

  it('closes on Escape and on outside (backdrop) click — MUI owns both', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ContextMenuView x={0} y={0} groups={GROUPS} onRun={() => {}} onClose={onClose} />)

    // The menu autofocuses its list, so the key lands on the surface.
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    // jsdom has no hit-testing: the "outside click" is a click on the
    // backdrop element MUI mounts under the paper.
    fireEvent.click(document.querySelector('.MuiBackdrop-root')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('carries the popup MARKER on the paper only — never the backdrop (the region gate reads it)', () => {
    render(<ContextMenuView x={0} y={0} groups={GROUPS} onRun={() => {}} onClose={() => {}} />)
    const paper = document.querySelector('.context-menu')!
    expect(paper.classList.contains('document-editor-popup')).toBe(true)
    expect(document.querySelector('.MuiBackdrop-root')!.classList.contains('document-editor-popup')).toBe(false)
  })

  const CUSTOM_GROUPS: ContextMenuGroup[] = [
    {
      id: 'cell',
      items: [
        {
          id: 'custom',
          label: 'Custom row',
          render: ({ api, close }) => (
            <button
              type="button"
              onClick={() => {
                api.exec('feature.custom', 'payload')
                close()
              }}
            >
              Pick
            </button>
          ),
        },
      ],
    },
  ]

  it('renders a custom `render` item with the live ctx — it execs with a payload and closes the menu', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    const onClose = vi.fn()
    render(
      <ContextMenuView
        x={0}
        y={0}
        groups={CUSTOM_GROUPS}
        onRun={() => {}}
        onClose={onClose}
        renderCtx={{ editor: null, api: mock.api }}
      />,
    )

    // Not a menuitem — the row hosts its own controls.
    expect(screen.queryByRole('menuitem')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Pick' }))
    expect(mock.execCalls).toContainEqual({ commandId: 'feature.custom', payload: 'payload' })
    expect(onClose).toHaveBeenCalled()
  })

  it('skips custom items when no renderCtx is provided (the pure-view path)', () => {
    render(<ContextMenuView x={0} y={0} groups={CUSTOM_GROUPS} onRun={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Pick' })).toBeNull()
  })
})

describe('<EditorContextMenu /> (the controller wired to a real editor)', () => {
  /** A real editor + the auto-mounted controller, the way DocumentEditor wires
   *  it. jsdom cannot resolve pixel coordinates, so each test stubs
   *  posAtCoords with the document position the "click" should land on. */
  function mountController(options?: Parameters<typeof renderEditor>[1]) {
    const created = renderEditor([TableFeature], options)
    render(
      <EditorContextMenu
        editor={created.editor}
        api={created.api}
        sections={created.resolved.contextMenu}
      />,
    )
    // Stub at mount: ProseMirror's OWN mouse handlers also call posAtCoords,
    // and the real one needs elementFromPoint, which jsdom lacks.
    const posAtCoords = vi.spyOn(created.editor.view, 'posAtCoords').mockReturnValue(null)
    const rightClick = (pos: { pos: number; inside: number } | null) => {
      posAtCoords.mockReturnValue(pos)
      // fireEvent returns false when preventDefault was called — i.e. the menu
      // claimed the click; true means the NATIVE menu would open.
      return fireEvent.contextMenu(created.editor.view.dom, { clientX: 120, clientY: 80 })
    }
    return { ...created, rightClick }
  }

  /** Start positions of every table cell (header cells included), doc order. */
  function cellPositions(editor: Editor): number[] {
    const cells: number[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') cells.push(pos)
    })
    return cells
  }

  it('right-click with a caret retargets it to the clicked cell, opens the menu and runs a REAL command', async () => {
    const created = mountController()
    created.api.exec('table.insert') // caret lands in the first cell
    const target = cellPositions(created.editor).at(-1)! + 2 // inside the LAST cell

    const nativePrevented = !created.rightClick({ pos: target, inside: 0 })
    expect(nativePrevented).toBe(true)
    // The caret moved to the clicked cell, so the action applies THERE.
    expect(created.editor.state.selection.from).toBe(target)

    // Activation is on CLICK (what Enter/Space produce on a <button>) — the
    // mousedown only guards the selection.
    fireEvent.click(await screen.findByRole('menuitem', { name: /Insert row below/ }))

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull()) // runs once, then closes
    const table = jsonFindNode(created.api.getJSON().doc, 'table')
    expect(table?.content).toHaveLength(4) // 3×3 grew a row — the real command ran
  })

  it('paints the right-clicked cell through the REAL cell background picker', async () => {
    const created = mountController()
    created.api.exec('table.insert') // 3x3, caret in the first header cell
    const target = cellPositions(created.editor).at(-1)! + 2 // inside the LAST cell

    created.rightClick({ pos: target, inside: 0 })

    // The custom row opens the same picker popover the bubble's swatch uses.
    fireEvent.click(await screen.findByRole('button', { name: 'Cell background color' }))
    fireEvent.click(await screen.findByRole('button', { name: '#d93025' }))

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull()) // picking closes it all
    const painted: string[] = []
    created.editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        if (node.attrs.backgroundColor) painted.push(node.attrs.backgroundColor)
      }
    })
    expect(painted).toEqual(['#d93025']) // exactly the clicked cell, nothing else
  })

  it('reflects the CURRENT fill: the well is painted and the matching swatch is marked active', async () => {
    const created = mountController()
    created.api.exec('table.insert') // caret lands in the first HEADER cell
    created.api.exec('table.setCellBackground', '#d93025') // paint THAT cell
    const target = cellPositions(created.editor)[0] + 2 // right-click the same cell

    created.rightClick({ pos: target, inside: 0 })

    // The row's well shows the cell's current fill (reads the tableHeader
    // branch of the attribute lookup — the painted cell is a header cell).
    const row = await screen.findByRole('button', { name: 'Cell background color' })
    expect(row.querySelector('.cell-background__well')).toHaveStyle({
      backgroundColor: '#d93025',
    })

    fireEvent.click(row)
    // In the picker, the matching swatch is the active one — not "No fill".
    expect(await screen.findByRole('button', { name: '#d93025' })).toHaveAttribute(
      'data-active',
      'true',
    )
    expect(screen.getByRole('button', { name: 'No fill' })).toHaveAttribute('data-active', 'false')
  })

  it('never collapses an existing selection — the right-button mousedown is suppressed and the range survives', () => {
    const created = mountController()
    created.api.exec('table.insert')
    created.editor.commands.insertContent('abc')
    const to = created.editor.state.selection.from
    created.editor.commands.setTextSelection({ from: to - 3, to })

    // The native caret-move on right-button mousedown is what would collapse
    // the selection before the menu opens — the controller eats it…
    expect(fireEvent.mouseDown(created.editor.view.dom, { button: 2 })).toBe(false)
    // …but leaves left-button clicks alone.
    expect(fireEvent.mouseDown(created.editor.view.dom, { button: 0 })).toBe(true)

    created.rightClick({ pos: cellPositions(created.editor).at(-1)! + 2, inside: 0 })
    // The selection is exactly what it was: the menu acts on it (Merge cells…).
    expect(created.editor.state.selection.from).toBe(to - 3)
    expect(created.editor.state.selection.to).toBe(to)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('falls back to the native menu when no section matches the clicked spot', () => {
    const created = mountController({ content: docWith('parágrafo fora de tabela') })

    const nativeAllowed = created.rightClick({ pos: 3, inside: 0 })

    expect(nativeAllowed).toBe(true) // no preventDefault → browser menu
    expect(screen.queryByRole('menu')).toBeNull()
    // And a right-button mousedown with a mere caret is not suppressed either.
    expect(fireEvent.mouseDown(created.editor.view.dom, { button: 2 })).toBe(true)
  })

  it('ignores right-clicks whose coordinates resolve to no document position', () => {
    const created = mountController()
    created.api.exec('table.insert')

    expect(created.rightClick(null)).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
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
