import { css } from '@emotion/react'

/* CalloutFeature — pure-DOM node view. */
/* Migrated from callout.css into the Emotion Global skin (aggregated by src/editor/skin.tsx). */
export const calloutStyles = css`
  .document-editor__surface .callout {
    display: flex;
    gap: 12px;
    padding: 12px 16px;
    background: var(--editor-callout-bg);
    border: 1px solid var(--editor-callout-border);
    border-left: 4px solid var(--editor-callout-accent);
    border-radius: 8px;
  }

  .document-editor__surface .callout__emoji {
    font-size: 18px;
    line-height: 1.6;
    user-select: none;
  }

  .document-editor__surface .callout__content {
    flex: 1;
  }
`
