import { css } from '@emotion/react'

/* The insert ACTIONS row — the footer bar's default content (the shell — the
   fixed rounded bar — is .document-editor__footer). Full height so popovers
   anchored to it (the variables panel) measure from the bar's top edge. */
export const insertToolbarStyles = css`
  .insert-dock {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .insert-dock__btn {
    width: 36px;
    height: 36px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    font-size: 14px;
    font-weight: 600;
    color: var(--editor-control-fg);
    cursor: pointer;
  }

  .insert-dock__btn:hover {
    background: var(--editor-subtle-bg);
  }

  .insert-dock__btn:focus-visible {
    outline: 2px solid var(--editor-accent);
    outline-offset: 1px;
  }
`
