import { css } from '@emotion/react'

/* Toolbar BUTTONS — the shared skin behind the bubble's controls (via
   .bubble-toolbar__inner) and any consumer-rendered button row. There is no
   styled toolbar container: the product has no static formatting bar. */
export const editorToolbarStyles = css`
  .editor-toolbar__btn {
    min-width: 32px;
    height: 32px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    font-size: 14px;
    font-weight: 600;
    color: var(--editor-control-fg);
    cursor: pointer;
  }

  .editor-toolbar__btn:hover {
    background: var(--editor-control-hover-bg);
  }

  .editor-toolbar__btn:focus-visible {
    outline: 2px solid var(--editor-accent);
    outline-offset: 1px;
  }

  .editor-toolbar__btn[aria-pressed='true'] {
    background: var(--editor-accent-bg);
    color: var(--editor-accent-ink);
  }

  .editor-toolbar__btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
`
