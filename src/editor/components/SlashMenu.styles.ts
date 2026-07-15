import { css } from '@emotion/react'

/* Slash (/) command menu — reused by the @ variable-chip menu. Portals to <body>. */
export const slashMenuStyles = css`
  /* The card is a MUI Paper; items are MUI MenuItems (hover/selected come
     from the theme). Only layout + the icon chip + empty state remain. */
  .document-editor-popup .slash-menu {
    display: flex;
    flex-direction: column;
    min-width: 220px;
    max-height: 280px;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--editor-border);
  }

  .document-editor-popup .slash-menu__item.slash-menu__item {
    gap: 10px;
    border-radius: 6px;
  }

  .document-editor-popup .slash-menu__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: var(--editor-subtle-bg);
    font-size: 12px;
    font-weight: 600;
    color: var(--editor-control-fg);
  }

  .document-editor-popup .slash-menu--empty {
    padding: 10px 12px;
    color: var(--editor-text-subtle);
    font-size: 13px;
  }
`
