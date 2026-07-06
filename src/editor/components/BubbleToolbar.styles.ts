import { css } from '@emotion/react'

/* Bubble menu — formatting on text selection (floated by TipTap). Overrides the
   shared .editor-toolbar__btn skin for the dark floating surface. */
export const bubbleToolbarStyles = css`
  /* Floating surface: must stack above the fixed insert dock (z 900). */
  .bubble-toolbar {
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

  .bubble-toolbar__inner .editor-toolbar__btn {
    color: var(--editor-inverse-fg);
  }

  .bubble-toolbar__inner .editor-toolbar__btn:hover {
    background: color-mix(in srgb, var(--editor-inverse-fg) 12%, var(--editor-inverse-bg));
  }

  .bubble-toolbar__inner .editor-toolbar__btn[aria-pressed='true'] {
    background: var(--editor-inverse-accent);
    color: var(--editor-inverse-bg);
  }
`
