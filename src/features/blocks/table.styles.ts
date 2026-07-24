import { css } from '@emotion/react'

/* TableFeature — table, cells, column resizing + cell selection. Aligned with
   prosemirror-tables' own style/tables.css, scoped to our surface. */
export const tableStyles = css`
  .document-editor__surface table {
    border-collapse: collapse;
    table-layout: fixed;
    width: 100%;
    margin: 0.5em 0;
    overflow: hidden;
  }

  .document-editor__surface th,
  .document-editor__surface td {
    border: 1px solid var(--editor-border-table);
    padding: 6px 10px;
    vertical-align: top;
    box-sizing: border-box;
    position: relative; /* anchor for the resize handle + selection overlay */
  }

  .document-editor__surface .tableWrapper {
    overflow-x: auto;
  }
  .document-editor__surface .column-resize-handle {
    position: absolute;
    right: -2px;
    top: 0;
    bottom: 0;
    width: 4px;
    z-index: 20;
    background: var(--editor-accent);
    pointer-events: none;
  }
  .document-editor__surface .resize-cursor {
    cursor: ew-resize;
    cursor: col-resize;
  }
  /* Blue overlay on cells selected via drag / column-row selection */
  .document-editor__surface .selectedCell::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 2;
    background: color-mix(in srgb, var(--editor-accent) 18%, transparent);
    pointer-events: none;
  }

  .document-editor__surface th {
    background: var(--editor-subtle-bg);
    font-weight: 600;
    text-align: left;
  }

  /* Borderless "columns layout" tables (the bubble's "Table columns" insert).
     Transparent (not removed) keeps the cell box geometry — and so the resize
     handles — aligned with a normal grid; the borders just go invisible.
     Scoped with the child combinator to the columns table's OWN cells
     (table > tbody > tr > cell) so a normal, bordered table NESTED inside a
     column keeps its borders — a descendant selector would zero those too.
     Nested borderless tables still work: each carries its own is-borderless
     class and matches on its own. */
  .document-editor__surface table.is-borderless > tbody > tr > th,
  .document-editor__surface table.is-borderless > tbody > tr > td {
    border-color: transparent;
  }

  .document-editor-popup .table-columns-picker__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    min-width: 140px;
  }

  .document-editor-popup .table-columns-picker__option {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--editor-control-fg);
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }

  .document-editor-popup .table-columns-picker__option:hover {
    background: var(--editor-subtle-bg);
  }

  .document-editor-popup .table-columns-picker__option:focus-visible {
    outline: 2px solid var(--editor-accent-ink);
    outline-offset: -2px;
  }

  /* The context menu's "Cell background color" row — a MenuItem look-alike
     (the real items are MUI MenuItems; this row hosts its own popover trigger
     so it can't be one). The dropdown-style color well sits in the icon
     column; the picker it opens reuses the color-picker classes
     (ColorFeature's skin) — the same popover as the bubble's text-color
     swatch. */
  .document-editor-popup.context-menu .cell-background__row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 4px 16px;
    border: none;
    background: transparent;
    color: var(--editor-control-fg);
    font-family: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }

  /* The well shows the CURRENT fill (transparent = no fill) behind a chevron. */
  .document-editor-popup.context-menu .cell-background__well {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 26px;
    border: 1px solid var(--editor-border-muted);
    border-radius: 8px;
    color: var(--editor-text-muted);
  }

  .document-editor-popup.context-menu .cell-background__row:hover {
    background: var(--editor-subtle-bg);
  }

  .document-editor-popup.context-menu .cell-background__row:focus-visible {
    outline: 2px solid var(--editor-accent-ink);
    outline-offset: -2px;
  }
`
