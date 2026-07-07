import { css } from '@emotion/react'

/* Bubble menu — formatting on text selection (floated by TipTap). The pill
   box; the BUTTONS inside are MUI, recolored by editorDarkTheme. */
export const bubbleToolbarStyles = css`
  /* Floating surface: must stack above the fixed footer/header bars (z 900).
     'position: relative' is what makes the z-index REAL — the class lands on
     the inner (static) div, not on TipTap's positioned wrapper, and z-index
     is inert on non-positioned elements. */
  .bubble-toolbar {
    position: relative;
    z-index: var(--editor-z-popup);
  }

  .bubble-toolbar__inner {
    display: inline-flex;
    flex-wrap: nowrap;
    gap: 2px;
    padding: 4px;
    background: var(--editor-inverse-bg);
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.36);
  }
`
