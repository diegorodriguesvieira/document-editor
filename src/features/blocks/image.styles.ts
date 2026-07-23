import { css } from '@emotion/react'

/* ImageFeature — images inside the page + the 8 resize handles. */
export const imageStyles = css`
  .document-editor__surface img {
    max-width: 100%;
    height: auto;
  }

  /* fit-content, NOT inline-block: a flex/grid parent blockifies inline-block
     children into stretched blocks — the handles would anchor to the column
     edge, not the image. */
  .document-editor__surface .image-resizer {
    position: relative;
    display: block;
    width: fit-content;
    max-width: 100%;
    line-height: 0;
  }

  /* Docs-style block alignment. The node view mirrors the image's align attr
     onto this wrapper; the serialized HTML is self-contained (renderHTML puts
     the same margins inline on the <img>). No attr = left. Longhand margins,
     IDENTICAL to the serialized style — one semantics in both worlds. */
  .document-editor__surface .image-resizer[data-align='center'] {
    margin-left: auto;
    margin-right: auto;
  }

  .document-editor__surface .image-resizer[data-align='right'] {
    margin-left: auto;
  }

  .document-editor__surface .image-resizer--selected img {
    outline: 2px solid var(--editor-accent);
    outline-offset: 1px;
  }

  /* The 8 resize handles — visible only while the image node is selected. */
  .document-editor__surface .image-resizer__handle {
    display: none;
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--editor-surface);
    border: 2px solid var(--editor-accent);
    border-radius: 2px;
    z-index: 1;
  }

  .document-editor__surface .image-resizer--selected .image-resizer__handle {
    display: block;
  }

  .document-editor__surface .image-resizer__handle--nw { top: -5px; left: -5px; cursor: nwse-resize; }
  .document-editor__surface .image-resizer__handle--ne { top: -5px; right: -5px; cursor: nesw-resize; }
  .document-editor__surface .image-resizer__handle--sw { bottom: -5px; left: -5px; cursor: nesw-resize; }
  .document-editor__surface .image-resizer__handle--se { bottom: -5px; right: -5px; cursor: nwse-resize; }
  .document-editor__surface .image-resizer__handle--n { top: -5px; left: calc(50% - 5px); cursor: ns-resize; }
  .document-editor__surface .image-resizer__handle--s { bottom: -5px; left: calc(50% - 5px); cursor: ns-resize; }
  .document-editor__surface .image-resizer__handle--w { top: calc(50% - 5px); left: -5px; cursor: ew-resize; }
  .document-editor__surface .image-resizer__handle--e { top: calc(50% - 5px); right: -5px; cursor: ew-resize; }
`
