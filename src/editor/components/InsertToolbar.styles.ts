import { css } from '@emotion/react'

/* The insert ACTIONS row — the footer bar's default content (the shell — the
   fixed rounded bar — is .document-editor__footer). Full height so popovers
   anchored to it (the variables panel) measure from the bar's top edge.
   Buttons are MUI (IconButton/ToggleButton, 32px theme metrics); the doubled
   class bumps the dock's larger 36px size above MUI's single-class styles. */
export const insertToolbarStyles = css`
  .insert-dock {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .insert-dock__btn.insert-dock__btn {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    border-radius: 8px;
  }

  .insert-dock__btn.insert-dock__btn:hover {
    background: var(--editor-subtle-bg);
  }
`
