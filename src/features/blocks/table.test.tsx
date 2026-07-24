import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  createMockEditor,
  BubbleBar,
  resolveFeatures,
  type EditorApi,
  type EditorStateView,
} from '../../editor'
import { docWith, jsonFindNode, parseSliceFromHTML, renderEditor } from '../../test/editorHarness'
import { BoldFeature } from '../marks/bold'
import { ColorFeature, DEFAULT_PALETTE } from '../custom/color'
import { createTableFeature, TableColumnsFeature, TableFeature } from './table'

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
    const table = jsonFindNode(api.getJSON().doc, 'table')
    expect(rows(api)).toBe(3)
    expect(cols(api)).toBe(3)
    expect(table?.attrs?.borderless).toBe(false) // the plain "Table" insert keeps its borders
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

    // Every default menu item points at a command the feature actually
    // registers; the one custom row (the background swatches) ships a render
    // instead of a commandId.
    const { commands } = resolveFeatures([TableFeature])
    const items = section!.groups.flatMap((group) => group.items)
    const ids = items.filter((item) => !item.render).map((item) => item.commandId)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(id && commands[id]).toBeDefined()
    expect(items.filter((item) => item.render).map((item) => item.id)).toEqual(['cell-background'])
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
      'cell-background': true,
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

describe("table.setCellBackground (the context menu's cell background swatches)", () => {
  /** backgroundColor of every cell (header cells included), doc order. */
  const backgrounds = (editor: ReturnType<typeof withTable>['editor']) => {
    const list: (string | null)[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        list.push(node.attrs.backgroundColor)
      }
    })
    return list
  }

  it('stamps the color on the current cell — attrs + inline style (the backend HTML contract)', () => {
    const { api } = withTable() // caret lands in the first HEADER cell
    expect(api.exec('table.setCellBackground', '#f9ab00')).toBe(true)
    expect(jsonFindNode(api.getJSON().doc, 'tableHeader')?.attrs?.backgroundColor).toBe('#f9ab00')
    // The color must survive as cell markup — the backend renders this HTML.
    // (jsdom serializes the style attribute normalized: hex becomes rgb().)
    expect(api.getHTML()).toMatch(/background-color: (#f9ab00|rgb\(249, 171, 0\))/)
  })

  it('paints every cell of a multi-cell selection, and unset clears them all', async () => {
    const { CellSelection } = await import('@tiptap/pm/tables')
    const { editor, api } = withTable()

    const cells: number[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos)
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[1])),
    )

    expect(api.exec('table.setCellBackground', 'rgb(26, 115, 232)')).toBe(true)
    expect(backgrounds(editor).filter(Boolean)).toEqual(['rgb(26, 115, 232)', 'rgb(26, 115, 232)'])

    expect(api.exec('table.unsetCellBackground')).toBe(true)
    expect(backgrounds(editor).filter(Boolean)).toEqual([])
  })

  it('parses back from HTML — the paste/backend pipeline round-trips the inline style', () => {
    const { editor } = withTable()
    const slice = parseSliceFromHTML(
      editor,
      '<table><tbody><tr><td style="background-color: rgb(217, 48, 37)"><p>x</p></td></tr></tbody></table>',
    )
    let parsed: string | null = null
    slice.content.descendants((node) => {
      if (node.type.name === 'tableCell') parsed = node.attrs.backgroundColor
      return parsed == null
    })
    expect(parsed).toBe('rgb(217, 48, 37)')
  })

  it('rejects payloads that could smuggle style declarations, leaving the cell untouched', () => {
    const { api, editor } = withTable()
    expect(api.exec('table.setCellBackground', 'red; background-image: url(x)')).toBe(false)
    expect(api.exec('table.setCellBackground', '</style><script>')).toBe(false)
    expect(api.exec('table.setCellBackground', '   ')).toBe(false)
    expect(api.exec('table.setCellBackground')).toBe(false)
    expect(backgrounds(editor).filter(Boolean)).toEqual([])
  })
})

describe('createTableFeature palette (shared with the bubble text-color picker)', () => {
  /** Mounts just the cell-background row out of the feature's context menu,
   *  against a mock editor — the same wiring the menu's `renderCtx` provides. */
  function renderCellBackgroundRow(feature: ReturnType<typeof createTableFeature>) {
    const mock = createMockEditor()
    const close = vi.fn()
    const item = feature
      .contextMenu![0].groups.flatMap((group) => group.items)
      .find((candidate) => candidate.id === 'cell-background')!
    render(<>{item.render!({ editor: null, api: mock.api, close })}</>)
    return { mock, close }
  }

  it('defaults to the SAME palette as the bubble text-color picker', async () => {
    const user = userEvent.setup()
    renderCellBackgroundRow(TableFeature)

    await user.click(screen.getByRole('button', { name: 'Cell background color' }))
    for (const color of DEFAULT_PALETTE) {
      expect(screen.getByRole('button', { name: color })).toBeInTheDocument()
    }
  })

  it('a custom palette replaces the presets, and picking one dispatches it as the payload', async () => {
    const user = userEvent.setup()
    const { mock, close } = renderCellBackgroundRow(
      createTableFeature({ palette: ['#123456', '#abcdef'] }),
    )

    await user.click(screen.getByRole('button', { name: 'Cell background color' }))
    expect(screen.getByRole('button', { name: '#123456' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: DEFAULT_PALETTE[0] })).toBeNull()

    await user.click(screen.getByRole('button', { name: '#abcdef' }))
    expect(mock.execCalls).toContainEqual({
      commandId: 'table.setCellBackground',
      payload: '#abcdef',
    })
    expect(close).toHaveBeenCalled()
  })
})

describe('table.insertColumns (the bubble\'s "Table columns" picker)', () => {
  it('replaces the selection with a single borderless row, text (with marks) in the first cell', () => {
    const created = renderEditor([TableFeature, BoldFeature], { content: docWith('hello') })
    const { api, editor } = created
    editor.commands.selectAll()
    expect(api.exec('bold.toggle')).toBe(true)

    expect(api.exec('table.insertColumns', { cols: 3 })).toBe(true)

    const table = jsonFindNode(api.getJSON().doc, 'table')
    expect(table?.attrs?.borderless).toBe(true) // a columns layout: no cell borders
    expect(table?.content?.length).toBe(1) // a single row, no header

    // The NodeView mirrors the attribute onto the live `<table>` so the CSS can
    // strip its borders (resizable tables ignore renderHTML's class otherwise).
    expect(editor.view.dom.querySelector('table')?.classList.contains('is-borderless')).toBe(true)

    const row = table!.content![0]
    // Plain data cells only — no header cells.
    expect(row.content?.map((cell) => cell.type)).toEqual(['tableCell', 'tableCell', 'tableCell'])

    const firstCellText = row.content![0].content?.[0]?.content?.[0]
    expect(firstCellText?.text).toBe('hello')
    expect(firstCellText?.marks?.[0]?.type).toBe('bold')

    // The other cells stay empty.
    expect(row.content![1].content?.[0]?.content).toBeUndefined()
    expect(row.content![2].content?.[0]?.content).toBeUndefined()
  })

  it('carries ANY selection into the first cell as nodes — mixed marks (color) survive, no HTML re-parse', () => {
    // The reported crash: the old path serialized the selection to HTML and
    // re-parsed it, throwing "Invalid HTML content" on the bare inline
    // `<span style="color">` a textStyle mark produces. Reproduce that exact
    // shape — bold run + colored run — and prove it lands intact.
    const created = renderEditor([TableFeature, BoldFeature, ColorFeature], {
      content: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Lorem Ipsum' },
                {
                  type: 'text',
                  marks: [{ type: 'textStyle', attrs: { color: 'rgb(0, 0, 0)' } }],
                  text: ' is dummy text.',
                },
              ],
            },
          ],
        },
      },
    })
    const { api, editor } = created
    editor.commands.selectAll()

    expect(() => api.exec('table.insertColumns', { cols: 2 })).not.toThrow()

    const table = jsonFindNode(api.getJSON().doc, 'table')
    expect(table?.attrs?.borderless).toBe(true)
    const inline = table!.content![0].content![0].content![0].content // first cell paragraph
    expect(inline?.map((run) => run.text)).toEqual(['Lorem Ipsum', ' is dummy text.'])
    expect(inline?.[0]?.marks?.[0]?.type).toBe('bold')
    expect(inline?.[1]?.marks?.[0]?.type).toBe('textStyle')
    expect(inline?.[1]?.marks?.[0]?.attrs?.color).toBe('rgb(0, 0, 0)')
  })

  it('replaces just the selected range — surrounding text is kept and split around the table', () => {
    const created = renderEditor([TableFeature], { content: docWith('AAA BBB CCC') })
    const { api, editor } = created
    // Select "BBB" (the bubble-bar path is a plain TextSelection, not selectAll).
    editor.commands.setTextSelection({ from: 5, to: 8 })

    expect(api.exec('table.insertColumns', { cols: 2 })).toBe(true)

    const top = api.getJSON().doc.content!.map((n) => n.type)
    expect(top).toEqual(['paragraph', 'table', 'paragraph']) // AAA · [BBB] · CCC
    const table = jsonFindNode(api.getJSON().doc, 'table')
    expect(table!.content![0].content![0].content![0].content![0].text).toBe('BBB')
    expect(api.getJSON().doc.content![0].content![0].text).toBe('AAA ')
    expect(api.getJSON().doc.content![2].content![0].text).toBe(' CCC')
  })

  it('a normal table nested inside a column stays bordered — only the columns table is borderless', () => {
    const created = renderEditor([TableFeature], { content: docWith('x') })
    const { api, editor } = created
    editor.commands.setTextSelection({ from: 1, to: 2 })
    api.exec('table.insertColumns', { cols: 2 }) // borderless columns, caret in first cell
    api.exec('table.insert') // a normal 3x3 table INSIDE the first column

    // Node level: the columns table is borderless, the nested one is not.
    const borderless: boolean[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'table') borderless.push(Boolean(node.attrs.borderless))
    })
    expect(borderless).toEqual([true, false]) // [outer columns, inner table]

    // CSS scoping: the nested table's cells must NOT be reachable by the
    // borderless rule. A descendant selector (the old bug) hit them; the
    // child-combinator selector (the fix) stops at the columns table's own row.
    const innerCell = editor.view.dom.querySelector('table:not(.is-borderless) td')!
    expect(innerCell.matches('table.is-borderless td')).toBe(true) // why it used to break
    expect(innerCell.matches('table.is-borderless > tbody > tr > td')).toBe(false) // the fix
    // The columns table's own cell IS zeroed by the fixed selector.
    const columnCell = editor.view.dom.querySelector('table.is-borderless > tbody > tr > td')!
    expect(columnCell.matches('table.is-borderless > tbody > tr > td')).toBe(true)
  })

  it('rejects out-of-range or missing column counts, leaving the doc unchanged', () => {
    const created = renderEditor([TableFeature], { content: docWith('hello') })
    const { api, editor } = created
    editor.commands.selectAll()

    expect(api.exec('table.insertColumns', { cols: 0 })).toBe(false)
    expect(api.exec('table.insertColumns', { cols: 5 })).toBe(false)
    expect(api.exec('table.insertColumns', { cols: 2.5 })).toBe(false)
    expect(api.exec('table.insertColumns')).toBe(false)

    expect(jsonFindNode(api.getJSON().doc, 'table')).toBeUndefined()
  })

  it('rejects when the selection contains an existing table (would nest tables)', () => {
    const created = renderEditor([TableFeature], { content: docWith('hello') })
    const { api, editor } = created
    expect(api.exec('table.insert')).toBe(true) // 3x3 table
    editor.commands.selectAll() // sweeps up the paragraph AND the table

    expect(api.exec('table.insertColumns', { cols: 2 })).toBe(false)
    // Still exactly the original 3x3 table — nothing changed.
    expect(jsonFindNode(api.getJSON().doc, 'table')?.content?.length).toBe(3)
  })

  it('rejects when the caret is already inside a table (would nest tables)', () => {
    const created = renderEditor([TableFeature])
    const { api, editor } = created
    expect(api.exec('table.insert')).toBe(true) // 3x3 table; caret in the first header cell
    editor.commands.insertContent('hi')
    editor.commands.setTextSelection({
      from: editor.state.selection.from - 2,
      to: editor.state.selection.from,
    })
    expect(editor.state.selection.empty).toBe(false)
    expect(editor.isActive('table')).toBe(true)

    expect(api.exec('table.insertColumns', { cols: 2 })).toBe(false)
    expect(jsonFindNode(api.getJSON().doc, 'table')?.content?.length).toBe(3) // still just the one table
  })

  it('disables the button while the selection is blocked, re-enables once it is not (real editor)', async () => {
    const created = renderEditor([TableFeature, TableColumnsFeature], { content: docWith('hello') })
    const { editor, api, resolved } = created
    render(<BubbleBar editor={editor} api={api} resolved={resolved} />)

    editor.commands.selectAll()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Table columns' })).toBeEnabled())

    act(() => {
      api.exec('table.insert')
      editor.commands.selectAll() // now sweeps up the paragraph AND the new table
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Table columns' })).toBeDisabled())
  })

  it('dispatches table.insertColumns with the picked column count (mock editor)', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    render(
      <BubbleBar
        editor={null}
        api={mock.api}
        resolved={resolveFeatures([TableFeature, TableColumnsFeature])}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Table columns' }))
    expect(screen.getByRole('button', { name: '3 columns' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '3 columns' }))
    expect(mock.execCalls).toContainEqual({
      commandId: 'table.insertColumns',
      payload: { cols: 3 },
    })
    // The popover closes after picking.
    expect(screen.queryByRole('button', { name: '3 columns' })).toBeNull()
  })
})
