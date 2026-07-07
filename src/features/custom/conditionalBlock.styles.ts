import { css } from '@emotion/react'

/* ConditionalBlockFeature — React node view + condition editor. */
export const conditionalBlockStyles = css`
  .document-editor__surface .conditional-block {
    margin: 0.6em 0;
    border: 1px solid var(--editor-border);
    border-radius: 10px;
    overflow: hidden;
  }

  .document-editor__surface .conditional-block__chrome {
    background: var(--editor-chrome-bg);
  }

  .document-editor__surface .conditional-block__bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--editor-border);
    user-select: none;
  }

  .document-editor__surface .conditional-block__summary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    border: none;
    background: transparent;
    font: inherit;
    color: var(--editor-control-fg);
    cursor: pointer;
    text-align: left;
  }

  .document-editor__surface .conditional-block__icon {
    color: var(--editor-text-muted);
  }

  .document-editor__surface .conditional-block__cond {
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--editor-cond-bg);
    color: var(--editor-cond-fg);
    font-size: 0.9em;
  }

  /* The bar buttons are MUI IconButtons (hover/disabled from the theme);
     only the muted chrome color needs to persist over MUI's action color. */
  .conditional-block__nest.conditional-block__nest,
  .conditional-block__delete.conditional-block__delete {
    color: var(--editor-control-fg);
  }

  .document-editor__surface .conditional-block__content {
    padding: 8px 12px;
  }

  /* Condition editor card */
  .document-editor__surface .cond-editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background: var(--editor-surface);
    border-bottom: 1px solid var(--editor-border);
  }

  /* Non-editable notice for multi-condition trees authored outside the UI. */
  .document-editor__surface .cond-editor__complex {
    margin: 0;
    font-size: 13px;
    color: var(--editor-text-muted);
  }

  .document-editor__surface .cond-editor__done.cond-editor__done {
    align-self: flex-end;
    padding: 8px 16px;
    border-radius: 8px;
    background: var(--editor-inverse-bg);
    color: var(--editor-inverse-fg);
    font-size: 13px;
  }
`
