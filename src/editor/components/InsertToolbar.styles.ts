import { css } from '@emotion/react'

/* Insert dock — a fixed, full-width rounded bar over the page footer, items
   centered. The document scrolls BEHIND it; the shell reserves clearance
   (see DocumentEditor.styles) so content can still scroll into view above it. */
export const insertToolbarStyles = css`
  .insert-dock {
    position: fixed;
    left: var(--editor-dock-gap);
    right: var(--editor-dock-gap);
    bottom: var(--editor-dock-gap);
    height: var(--editor-dock-height);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 16px;
    background: var(--editor-surface);
    border: 1px solid var(--editor-border);
    border-radius: 16px;
    box-shadow: var(--editor-shadow-sm);
    z-index: var(--editor-z-dock);
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
