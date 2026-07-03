/* CommentsFeature — the anchored mark. The comment body shows in the side panel
   (see commentsPanel.css). Scoped: a consumer page's own '.comment' class must
   not pick up SDK styles.
   Migrated from comments.css into the Emotion Global skin (aggregated by
   src/editor/skin.tsx). The skin is unlayered; token overrides still work,
   specificity is standard. */
import { css } from '@emotion/react'

export const commentsStyles = css`
  .document-editor__surface .comment {
    background: var(--editor-comment-bg);
    border-bottom: 2px solid var(--editor-comment-accent);
  }
`
