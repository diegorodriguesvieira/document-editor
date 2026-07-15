/* The "Add comment" balloon floating under a read-only text selection. */
import { css } from '@emotion/react'

export const commentsLayerStyles = css`
  .comment-balloon {
    background: var(--editor-surface);
    border: 1px solid var(--editor-border);
    border-radius: 999px;
    box-shadow: var(--editor-shadow-pop);
  }

  /* Doubled class beats MUI's single-class button styles. */
  .comment-balloon .comment-balloon__button.comment-balloon__button {
    padding: 4px 14px;
    border-radius: 999px;
    color: var(--editor-text);
    font-size: 13px;
  }
`
