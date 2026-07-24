import { useRef, useState } from 'react'
import IconButton from '@mui/material/IconButton'
import { useTheme } from '@mui/material/styles'
import ExpandMore from '@mui/icons-material/ExpandMore'
import type { Editor } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableKit, TableView } from '@tiptap/extension-table'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import {
  defineFeature,
  PopupShell,
  useFeatureState,
  type ContextMenuRenderContext,
  type FeatureRenderContext,
} from '../../editor'
import { DEFAULT_PALETTE, isSafeCssColor } from '../custom/color'
import { popupTriggerProps } from '../promptForms'
import { icons } from '../icons'

const TABLE_COLUMN_OPTIONS = [1, 2, 3, 4]

/**
 * A `<table>` NodeView that mirrors the node's `borderless` attribute onto the
 * live DOM as an `is-borderless` class. In the editor, resizable tables render
 * through prosemirror-tables' TableView, which builds its own `<table>` element
 * and ignores node attributes — so the class emitted by `renderHTML` never
 * reaches the editable DOM. This subclass re-applies it. (Read-only rendering
 * has no NodeView and picks the class up from `renderHTML` directly.)
 */
class BorderlessTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number) {
    super(node, cellMinWidth)
    this.syncBorderless(node)
  }

  update(node: ProseMirrorNode): boolean {
    const kept = super.update(node)
    if (kept) this.syncBorderless(node)
    return kept
  }

  private syncBorderless(node: ProseMirrorNode) {
    this.table.classList.toggle('is-borderless', Boolean(node.attrs.borderless))
  }
}

/**
 * Our `table` node, extended with a persistent `borderless` boolean. The
 * bubble's "Table columns" quick-insert sets it (a borderless columns layout);
 * the footer's "Table" insert leaves it `false` (a normal bordered grid). It
 * round-trips through HTML as an `is-borderless` class so copy/paste and export
 * preserve it, and {@link BorderlessTableView} mirrors it inside the editor.
 */
const BorderlessTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borderless: {
        default: false,
        parseHTML: (element) => element.classList.contains('is-borderless'),
        renderHTML: (attributes) => (attributes.borderless ? { class: 'is-borderless' } : {}),
      },
    }
  },
})

/**
 * The `backgroundColor` attribute both cell types share. It round-trips as an
 * inline `background-color` style — the backend/PDF pipeline renders the
 * document's own HTML, so the color must live on the cell markup itself
 * (attrs + inline style), never in editor-only CSS. Inline style also outranks
 * the skin's `th { background }` rule, so painted header cells win.
 */
const cellBackgroundAttributes = () => ({
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
    renderHTML: (attributes: { backgroundColor?: string | null }) =>
      attributes.backgroundColor
        ? { style: `background-color: ${attributes.backgroundColor}` }
        : {},
  },
})

/** `tableCell`/`tableHeader` with the persistent `backgroundColor` attribute —
 *  the context menu's "Cell background" swatches write it via
 *  `table.setCellBackground`. */
const BackgroundTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackgroundAttributes() }
  },
})

const BackgroundTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackgroundAttributes() }
  },
})

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
 * The bubble's "Table columns" button: pick 1–4 and a borderless columns
 * layout of that width replaces the selection — a single header-less row with
 * the selected text (formatting intact) in the first cell. A `PopupShell` menu
 * of plain options — same shape as `ColorControl`'s swatch grid, just a
 * vertical list of labels instead of colors.
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

/**
 * The context menu's "Cell background color" row: a MenuItem-look-alike with
 * a dropdown-style color well (current fill + chevron) in the icon column and
 * the label beside it. Clicking the row opens the SAME picker popover the
 * bubble's text-color swatch uses (PopupShell + `color-picker` classes and
 * palette), dropping down from the well. It acts on the right-clicked cell
 * (or the whole cell selection) via `table.setCellBackground`; "No fill"
 * clears; "+" fires the native picker, which live-applies on change (only
 * picking a preset/No fill closes the menu). The popper needs an inline
 * z-index above MUI's modal Menu — the skin's `--editor-z-popup` (1000) sits
 * below it, so without the override every click would land on the menu's
 * backdrop instead of the picker.
 */
function CellBackgroundControl({
  editor,
  api,
  close,
  palette,
}: ContextMenuRenderContext & { palette: string[] }) {
  const [open, setOpen] = useState(false)
  const rowRef = useRef<HTMLButtonElement>(null)
  const wellRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const muiTheme = useTheme()
  const current =
    useFeatureState(
      editor,
      (ed) =>
        ((ed.getAttributes('tableCell').backgroundColor ??
          ed.getAttributes('tableHeader').backgroundColor) as string | undefined) ?? null,
    ) ?? null

  const pick = (commandId: string, payload?: string) => {
    api.exec(commandId, payload)
    close() // unmounts the whole menu, picker included
  }

  return (
    <>
      <button
        ref={rowRef}
        type="button"
        className="cell-background__row"
        {...popupTriggerProps('Cell background color', open, () => setOpen((value) => !value), 'menu')}
      >
        <span
          ref={wellRef}
          className="cell-background__well"
          style={current ? { backgroundColor: current } : undefined}
        >
          <ExpandMore fontSize="small" />
        </span>
        <span>Cell background color</span>
      </button>
      <PopupShell
        anchorEl={wellRef.current}
        dismissEl={rowRef.current}
        open={open}
        onClose={() => setOpen(false)}
        surfaceClassName="color-picker"
        role="menu"
        ariaLabel="Cell background color"
        placement="bottom-start"
        offset={[0, 4]}
        popperProps={{
          style: { zIndex: muiTheme.zIndex.modal + 1 },
          onMouseDown: (event) => event.preventDefault(),
        }}
        paperProps={{ sx: { p: 1.5 } }}
      >
        <div className="color-picker__grid">
          <button
            type="button"
            className="color-picker__swatch color-picker__default"
            title="No fill"
            aria-label="No fill"
            data-active={current == null}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick('table.unsetCellBackground')}
          >
            ✕
          </button>
          {palette.map((color) => (
            <button
              key={color}
              type="button"
              className="color-picker__swatch"
              title={color}
              aria-label={color}
              data-active={current?.toLowerCase() === color.toLowerCase()}
              style={{ backgroundColor: color }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick('table.setCellBackground', color)}
            />
          ))}
          <button
            type="button"
            className="color-picker__swatch color-picker__custom"
            title="Custom color"
            aria-label="Custom color"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => inputRef.current?.click()}
          >
            +
          </button>
        </div>
        {/* Hidden native picker — the "+" triggers it; live-applies on change. */}
        <input
          ref={inputRef}
          type="color"
          className="color-picker__input"
          defaultValue={current ?? '#ffffff'}
          onChange={(event) => api.exec('table.setCellBackground', event.target.value)}
        />
      </PopupShell>
    </>
  )
}

export interface TableFeatureOptions {
  /** Preset swatches of the cell background picker. Defaults to the SAME
   *  `DEFAULT_PALETTE` the bubble's text-color picker uses, so the two stay
   *  in sync out of the box — when you give `createColorFeature` a custom
   *  palette, pass the same array here. */
  palette?: string[]
}

/** Tables (TableKit bundles Row + Header + Cell; we swap its Table for the
 *  {@link BorderlessTable} variant so the "Table columns" insert can be
 *  borderless, and its cell types for the `backgroundColor`-carrying ones).
 *  `resizable` installs ProseMirror's columnResizing plugin — drag handles on
 *  column borders — with `BorderlessTableView` as its node view. (Row height
 *  isn't resizable in ProseMirror tables; it follows the cell content.)
 *
 *  The palette is COMPOSITION-TIME config, like every feature option — same
 *  caveat as `createColorFeature`: editor identity is keyed by feature ids,
 *  so swapping to a same-id feature with a different palette at runtime is
 *  deliberately ignored (remount with `key` if you truly need that).
 *
 *  Contributes — insert: "Table" · context menu: row/column/cell actions +
 *  a cell background color picker · commands: `table.*` · keymap: Mod-Alt-t. (The
 *  bubble's "Table columns" button is the separate {@link TableColumnsFeature}.) */
export function createTableFeature({ palette = DEFAULT_PALETTE }: TableFeatureOptions = {}) {
  return defineFeature({
    id: 'table',
    extensions: () => [
      TableKit.configure({ table: false, tableCell: false, tableHeader: false }),
      BorderlessTable.configure({ resizable: true, View: BorderlessTableView }),
      BackgroundTableCell,
      BackgroundTableHeader,
    ],
    commands: {
      'table.insert': (editor) =>
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      // Replaces the selection with a borderless columns layout of the chosen
      // width (1–4 cols): a single header-less row, with the selected content in
      // the first cell and the rest empty. The bordered, header-topped grid is
      // the footer's "Table" insert instead.
      //
      // The selected content is carried over as ProseMirror NODES, not an HTML
      // string: a table cell is `block+`, so whatever was selected fits, and the
      // marks (colours, links, bold…) survive verbatim. The old HTML round-trip
      // re-parsed the selection and blew up on bare inline content such as a lone
      // `<span style="color">`.
      'table.insertColumns': (editor, payload) => {
        const cols = Number((payload as { cols?: number } | undefined)?.cols)
        if (!Number.isInteger(cols) || cols < 1 || cols > 4) return false
        if (selectionBlocksTableColumns(editor)) return false

        const { selection, schema } = editor.state
        const { paragraph, table, tableRow, tableCell } = schema.nodes
        if (!paragraph || !table || !tableRow || !tableCell) return false

        // The selection's own slice becomes the first cell's body — an inline
        // selection arrives wrapped in its paragraph, so this is always `block+`.
        const selected = selection.empty ? Fragment.empty : selection.content().content
        let node: ProseMirrorNode
        try {
          const cells = [
            tableCell.createChecked(null, selected.childCount ? selected : paragraph.create()),
          ]
          for (let i = 1; i < cols; i += 1) cells.push(tableCell.createChecked(null, paragraph.create()))
          node = table.createChecked({ borderless: true }, tableRow.createChecked(null, cells))
        } catch {
          // The selection can't legally live in a cell — leave the doc untouched
          // rather than throw (which would strand the content mid-command).
          return false
        }

        return editor
          .chain()
          .focus()
          .command(({ tr, dispatch }) => {
            if (dispatch) {
              const from = tr.selection.from
              tr.replaceSelectionWith(node)
                .setSelection(TextSelection.near(tr.doc.resolve(from + 1)))
                .scrollIntoView()
            }
            return true
          })
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
      // The color lands in an inline `background-color` style on the cell —
      // part of the backend HTML contract — so the payload passes the same
      // injection gate as `color.set`. Applies to every selected cell.
      'table.setCellBackground': (editor, payload) => {
        const color = typeof payload === 'string' ? payload.trim() : ''
        if (!isSafeCssColor(color)) return false
        return editor.chain().focus().setCellAttribute('backgroundColor', color).run()
      },
      'table.unsetCellBackground': (editor) =>
        editor.chain().focus().setCellAttribute('backgroundColor', null).run(),
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
              // The picker row (custom render, no commandId): the swatches exec
              // table.setCellBackground themselves, with the color as payload.
              // setCellAttr refuses a no-op (same value), so probe with BOTH null
              // and a color — one of them always differs from the current fill.
              { id: 'cell-background', label: 'Cell background color', isAvailable: (e) => e.can().setCellAttribute('backgroundColor', null) || e.can().setCellAttribute('backgroundColor', '#000'), render: (ctx) => <CellBackgroundControl {...ctx} palette={palette} /> },
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
}

/** Zero-config tables — cell background presets on the default (shared)
 *  palette. See {@link createTableFeature} to customize. */
export const TableFeature = createTableFeature()

/**
 * The bubble's "Table columns" quick-insert. A separate, bubble-only
 * feature (no extensions of its own) rather than a `bubble` entry on
 * `TableFeature`: that lets it be slotted anywhere in the app's feature
 * array — right next to `ListsFeature`, in this app's preset — without
 * disturbing `TableFeature`'s own position, which also drives the footer
 * insert-dock's "Table" button order. `dependsOn` gives a clear boot error
 * instead of a silently no-op button if it's ever enabled without `table`.
 *
 * Contributes — bubble: "Table columns" (custom control) · command:
 * `table.insertColumns`.
 */
export const TableColumnsFeature = defineFeature({
  id: 'tableColumns',
  dependsOn: ['table'],
  extensions: () => [],
  bubble: [
    {
      id: 'tableColumns',
      group: 'blocks',
      label: 'Table columns',
      render: (ctx) => <TableColumnsControl {...ctx} />,
    },
  ],
})
