import { css } from '@emotion/react'

/* DividerFeature — horizontal rule inside the page.
   Migrated from divider.css into the Emotion Global skin (aggregated by src/editor/skin.tsx). */
export const dividerStyles = css`
  .document-editor__surface hr {
    border: none;
    border-top: 1px solid var(--editor-border-muted);
    margin: 1em 0;
  }
`
