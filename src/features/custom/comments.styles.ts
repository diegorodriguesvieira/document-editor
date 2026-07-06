/* CommentsFeature — the anchored mark. The comment body shows in the side
   panel (see commentsPanel.styles.ts). Scoped: a consumer page's own
   '.comment' class must not pick up SDK styles. */
import { css } from '@emotion/react'

export const commentsStyles = css`
  .document-editor__surface .comment {
    background: var(--editor-comment-bg);
    border-bottom: 2px solid var(--editor-comment-accent);
  }
`
