/* CommentsFeature — the review-mode highlight DECORATIONS (the document
   itself never carries comments). Scoped: a consumer page's own '.comment'
   class must not pick up SDK styles. */
import { css } from '@emotion/react'

export const commentsStyles = css`
  .document-editor__surface .comment {
    background: var(--editor-comment-bg);
    border-bottom: 2px solid var(--editor-comment-accent);
  }

  /* The selection being commented on right now (composer open). */
  .document-editor__surface .comment--draft {
    border-bottom-style: dashed;
  }

  /* The comment clicked in the panel — "here it is" emphasis. */
  .document-editor__surface .comment--active {
    background: color-mix(in srgb, var(--editor-comment-accent) 35%, var(--editor-comment-bg));
  }
`
