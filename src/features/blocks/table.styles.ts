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
     handles — aligned with a normal grid; the borders just go invisible. */
  .document-editor__surface table.is-borderless th,
  .document-editor__surface table.is-borderless td {
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
`
