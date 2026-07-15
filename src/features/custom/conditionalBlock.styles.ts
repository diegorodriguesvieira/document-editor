import { css } from '@emotion/react'

/* ConditionalBlockFeature — React node view + condition editor. */
export const conditionalBlockStyles = css`
  .document-editor__surface .conditional-block {
    margin: 0.6em 0;
    padding: 8px;
    border: 1px solid var(--editor-border);
    border-radius: 16px;
    background: var(--editor-cond-block-bg);
  }

  /* Nested blocks draw no card of their own — the design nests bars, not
     boxes; depth reads from the parent content's LEFT indentation only. The
     negative right margin cancels the parent content's right padding (32px,
     keep in sync) so the bars and their ⊕/🗑 actions of every level stay
     right-aligned with the outer bar. The chain (content > contentDOM >
     TipTap's .react-renderer > view) pins DIRECT nesting only — a conditional
     further down (e.g. inside a table) keeps its own card. */
  .document-editor__surface
    .conditional-block__content
    > div
    > .react-renderer.node-conditionalBlock {
    margin: 0.5em -32px 0.5em 0;
  }

  .document-editor__surface
    .conditional-block__content
    > div
    > .react-renderer.node-conditionalBlock
    > .conditional-block {
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
  }

  /* Anchor for the floating condition editor. */
  .document-editor__surface .conditional-block__chrome {
    position: relative;
  }

  .document-editor__surface .conditional-block__bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 10px;
    user-select: none;
  }

  /* Blocks that contain nested conditionals get the grouped (gray) bar. */
  .document-editor__surface .conditional-block__bar--group {
    background: var(--editor-cond-bar-bg);
  }

  .document-editor__surface .conditional-block__summary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    font: inherit;
    color: var(--editor-text);
    cursor: pointer;
    text-align: left;
  }

  .document-editor__surface .conditional-block__icon {
    display: inline-flex;
    color: var(--editor-text);
  }

  .document-editor__surface .conditional-block__icon svg {
    font-size: 20px;
  }

  .document-editor__surface .conditional-block__chip {
    display: inline-block;
    padding: 2px 12px;
    border: 1px solid var(--editor-cond-border);
    border-radius: 9px;
    background: var(--editor-cond-bg);
    color: var(--editor-cond-fg);
    font-size: 1em;
    white-space: nowrap;
  }

  .document-editor__surface .conditional-block__count {
    color: var(--editor-text-muted);
    font-size: 0.95em;
    white-space: nowrap;
  }

  /* The bar buttons are MUI IconButtons (hover/disabled from the theme);
     the muted chrome color needs to persist over MUI's action color, and a
     tighter padding keeps the ⊕/🗑 cluster as compact as the design. */
  .conditional-block__toggle.conditional-block__toggle,
  .conditional-block__nest.conditional-block__nest,
  .conditional-block__delete.conditional-block__delete {
    padding: 4px;
    color: var(--editor-control-fg);
  }

  .document-editor__surface .conditional-block__content {
    padding: 12px 32px 16px;
  }

  .document-editor__surface .conditional-block--collapsed > .conditional-block__content {
    display: none;
  }

  /* Condition editor — a popover floating below the bar (over the content). */
  .document-editor__surface .cond-editor {
    position: absolute;
    top: calc(100% + 4px);
    left: 10px;
    z-index: var(--editor-z-popup);
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(420px, calc(100% - 20px));
    padding: 20px;
    background: var(--editor-surface);
    border-radius: 12px;
    box-shadow: var(--editor-shadow-pop);
  }

  .document-editor__surface .cond-editor__group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .document-editor__surface .cond-editor__label {
    font-size: 13px;
    font-weight: 500;
    color: var(--editor-text);
  }

  /* Non-editable notice for multi-condition trees authored outside the UI. */
  .document-editor__surface .cond-editor__complex {
    margin: 0;
    font-size: 13px;
    color: var(--editor-text-muted);
  }

  .document-editor__surface .cond-editor__done.cond-editor__done {
    align-self: flex-end;
    padding: 8px 20px;
    border-radius: 10px;
    background: var(--editor-inverse-bg);
    color: var(--editor-inverse-fg);
    font-size: 13px;
  }
`
