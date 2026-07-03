import { css } from '@emotion/react'

/* HeadingFeature — h1–h3 inside the page.
   Migrated from heading.css into the Emotion Global skin (aggregated by src/editor/skin.tsx). */
export const headingStyles = css`
  .document-editor__surface h1 {
    font-size: 26px;
    font-weight: 400;
  }

  .document-editor__surface h2 {
    font-size: 22px;
    font-weight: 400;
  }

  .document-editor__surface h3 {
    font-size: 18px;
    font-weight: 500;
  }
`
