/* CommentsFeature — the comment highlights. Everything here styles
   DECORATIONS (nothing about a comment lives in the document): the segments
   plugin slices all live anchor ranges into disjoint spans, each rendered as
   one `.comment` span carrying `data-comment-id` (innermost) and
   `data-comment-ids` (every covering id). `--stacked` marks a slice covered
   by 2+ comments, `--active` the clicked comment's slices, `--draft` the
   range being composed. Scoped: a consumer page's own '.comment' class must
   not pick up SDK styles. */
import { css } from '@emotion/react'

export const commentsStyles = css`
  .document-editor__surface .comment {
    background: color-mix(in srgb, var(--editor-comment-accent) 18%, transparent);
    border-bottom: 2px solid var(--editor-comment-accent);
  }

  /* Overlaps: the slicing renders ONE span per disjoint slice (nothing
     nests), so "overlap reads darker" is an explicit class — two 18% layers
     ≈ one 33%. */
  .document-editor__surface .comment--stacked {
    background: color-mix(in srgb, var(--editor-comment-accent) 33%, transparent);
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
