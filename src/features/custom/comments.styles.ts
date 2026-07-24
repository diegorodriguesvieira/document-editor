/* CommentsFeature — the comment highlights: `.comment` is the MARK's span
   (the anchor lives in the document; overlapping comments nest spans, so
   their backgrounds stack slightly darker), `--draft`/`--active` are
   decoration emphasis on top. Scoped: a consumer page's own '.comment'
   class must not pick up SDK styles. */
import { css } from '@emotion/react'

export const commentsStyles = css`
  /* Translucent on purpose: overlapping comments render as NESTED spans, and
     only a see-through background lets the overlap actually read darker. */
  .document-editor__surface .comment {
    background: color-mix(in srgb, var(--editor-comment-accent) 18%, transparent);
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
