import { css, keyframes } from '@emotion/react'

/* Editor shell + the flat page surface.
   Migrated from DocumentEditor.css into the Emotion Global skin (aggregated by
   src/editor/skin.tsx). The Emotion skin is unlayered; token overrides still
   work, specificity is standard. */

const editorGapcursorBlink = keyframes`
  to {
    visibility: hidden;
  }
`

export const documentEditorStyles = css`
  /* 3-column grid: side rails live in the gutters pinned to the browser edges,
     so the content column is centered in the VIEWPORT (a flex row would center
     the rail+column+rail group instead, pushing the text off-center). */
  .document-editor {
    display: grid;
    grid-template-columns:
      minmax(min-content, 1fr)
      minmax(0, var(--editor-page-width))
      minmax(min-content, 1fr);
    column-gap: 16px;
  }

  /* Rails stretch with the row (so their inner sticky bars can stick) and pin
     to the edges at --editor-rail-gutter. */
  .document-editor__rail {
    grid-column: 1;
    justify-self: start;
    margin-left: var(--editor-rail-gutter);
  }

  .document-editor__rail--right {
    grid-column: 3;
    justify-self: end;
    margin-left: 0;
    margin-right: var(--editor-rail-gutter);
  }

  /* Height chain: when the consumer gives .document-editor a height (e.g. a
     flex-column parent with the editor as flex:1), it flows down to the page —
     so the page fills "viewport minus WHATEVER chrome the app has" with zero
     math, any header height. Without a sized parent, everything is content-
     sized and --editor-page-min-height is the fallback page height.
     'flex: 1 0 auto' = grow to fill, never shrink, content-sized otherwise. */
  .document-editor__column {
    grid-column: 2;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* Empty state: centered on the SCREEN (fixed, so scroll/layout don't move
     it), invisible to the mouse so the editor beneath keeps receiving clicks —
     the consumer's own children (e.g. a CTA button) become clickable again. */
  .document-editor__empty-state {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .document-editor__empty-state > * {
    pointer-events: auto;
  }

  /* The height chain, in one place: each link grows to fill the height handed
     down by the consumer and stays content-sized otherwise (see the comment on
     .document-editor__column). Breaking ONE link strands the page height. */
  .document-editor__zoom,
  .document-editor__scale,
  .document-editor__surface {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }

  /* Page zoom: the page scrolls inside its column when zoomed IN (rails stay
     put). The overflow clip exists ONLY then — at 100% it would slice off
     chrome that legitimately pokes past a full-width block (an image's resize
     handles and selection ring at the column edge). While zoomed, the same
     chrome survives because overflow clips at the PADDING box: the 8px
     padding (offset by the negative margin, so layout doesn't move) is paint
     slack for the handles (5px + 2px border) and the ring (3px). */
  .document-editor__zoom--scrolls {
    overflow-x: auto;
    padding: 0 8px;
    margin: 0 -8px;
  }

  .document-editor__scale {
    width: var(--editor-page-width);
    transition: zoom 0.1s ease;
  }

  /* The page: a flat content column — the CANVAS is white, the column itself
     has no card chrome (no background/border/shadow). */
  .document-editor__surface .ProseMirror {
    flex: 1 0 auto;
    min-height: var(--editor-page-min-height);
    padding: var(--editor-page-padding);
    outline: none;
  }

  .document-editor__surface .ProseMirror > * + * {
    margin-top: 0.6em;
  }

  /* Gap cursor: a blinking caret in the gaps around isolating/atom blocks (a
     nested conditional, a table…) so you can type before/after them.
     DELIBERATELY OUTSIDE @layer editor: TipTap injects its own gap-cursor CSS at
     runtime as an UNLAYERED <style>, and unlayered rules beat any layer — so
     these overrides must be unlayered too, or the injected 'top: -2px' etc. win.
     They compete with the ENGINE's injected styles, not with consumer CSS. */
  .document-editor__surface .ProseMirror-gapcursor {
    display: none;
    pointer-events: none;
    position: absolute;
  }
  .document-editor__surface .ProseMirror-gapcursor::after {
    content: '';
    display: block;
    position: absolute;
    top: -2px;
    width: 20px;
    border-top: 1px solid var(--editor-text);
    animation: ${editorGapcursorBlink} 1.1s steps(2, start) infinite;
  }

  /* A gap BELOW a block sits after its collapsed bottom margin (~10px of air),
     but a gap ABOVE one lands exactly on the block's top border — glued to it.
     When a block follows the cursor (:not(:last-child)), lift the dash to
     mirror the below-gap breathing room. */
  .document-editor__surface .ProseMirror-gapcursor:not(:last-child)::after {
    top: -9px;
  }
  .document-editor__surface .ProseMirror-focused .ProseMirror-gapcursor {
    display: block;
  }
`
