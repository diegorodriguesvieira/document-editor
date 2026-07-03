/* QuoteFeature — blockquote inside the page. */
/* Migrated from blockquote.css into the Emotion Global skin (aggregated by src/editor/skin.tsx). */
import { css } from '@emotion/react'

export const blockquoteStyles = css`
  .document-editor__surface blockquote {
    margin: 0.5em 0;
    padding-left: 16px;
    border-left: 4px solid var(--editor-border-muted);
    color: var(--editor-text-muted);
  }
`
