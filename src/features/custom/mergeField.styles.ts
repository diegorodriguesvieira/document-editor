/* MergeFieldFeature — pure-DOM chip + the variables side panel (portals to
   <body>, anchored to the right of the insert rail, top-aligned with it).
   Migrated from mergeField.css into the Emotion Global skin (aggregated by
   src/editor/skin.tsx). */
import { css, keyframes } from '@emotion/react'

const editorChipLand = keyframes`
  0% {
    transform: scale(0.85);
    background: var(--editor-accent-bg);
  }
  60% {
    transform: scale(1.04);
  }
  100% {
    transform: scale(1);
    background: var(--editor-mergefield-bg);
  }
`

export const mergeFieldStyles = css`
  .document-editor__surface .merge-field {
    display: inline-block;
    padding: 0 6px;
    margin: 0 1px;
    border-radius: 4px;
    background: var(--editor-mergefield-bg);
    border: 1px solid var(--editor-mergefield-border);
    color: var(--editor-mergefield-fg);
    font-size: 0.9em;
    white-space: nowrap;
    user-select: none;
  }

  .document-editor-popup.mf-panel {
    position: fixed;
    width: min(340px, 80vw);
    max-height: calc(100vh - 120px);
    display: flex;
    flex-direction: column;
    background: var(--editor-surface);
    border: 1px solid var(--editor-border);
    border-radius: 12px;
    box-shadow: var(--editor-shadow-pop);
    padding: 14px;
    z-index: var(--editor-z-popup);
  }

  .document-editor-popup .mf-panel__search {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 10px;
    border: 1px solid var(--editor-border-muted);
    border-radius: 8px;
    font: inherit;
    font-size: 13px;
    margin-bottom: 10px;
  }

  .document-editor-popup .mf-panel__body {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .document-editor-popup .mf-panel__group-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--editor-text-subtle);
    margin-bottom: 6px;
  }

  .document-editor-popup .mf-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .document-editor-popup .mf-panel__header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .document-editor-popup .mf-panel__pin {
    width: 24px;
    height: 24px;
    border: 1px solid var(--editor-border-muted);
    border-radius: 6px;
    background: transparent;
    color: var(--editor-text-muted);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
  }

  .document-editor-popup .mf-panel__pin[aria-pressed='true'] {
    background: var(--editor-accent-bg);
    border-color: var(--editor-accent);
    color: var(--editor-accent-ink);
  }

  .document-editor-popup .mf-panel__close {
    border: none;
    background: transparent;
    font-size: 20px;
    line-height: 1;
    color: var(--editor-text-muted);
    cursor: pointer;
  }

  .document-editor-popup .mf-panel__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .document-editor-popup .mf-chip {
    padding: 6px 12px;
    border: 1px solid var(--editor-mergefield-border);
    border-radius: 16px;
    background: var(--editor-mergefield-bg);
    color: var(--editor-mergefield-fg);
    font-size: 13px;
    cursor: pointer;
  }

  .document-editor-popup .mf-chip:hover {
    background: var(--editor-accent-bg);
  }

  .document-editor-popup .mf-panel__empty {
    color: var(--editor-text-subtle);
    font-size: 13px;
  }

  /* ---- Drag & drop micro-interactions ---------------------------------- */

  /* While a chip drag is in flight the panel steps aside: see-through, and
     click-through (pointer-events: none) so the paper underneath stays a
     valid drop target — native drag hit-testing skips the panel entirely. */
  .document-editor-popup.mf-panel {
    transition: opacity 0.15s ease;
  }

  .document-editor-popup.mf-panel--drag-through {
    opacity: 0.25;
    pointer-events: none;
  }

  /* The source chip "lifts" (fades) while its drag is in flight. */
  .document-editor-popup .mf-chip--dragging {
    opacity: 0.45;
  }

  /* Custom drag image: the DOCUMENT chip ({{label}}), parked offscreen just
     long enough for the browser to snapshot it at dragstart. */
  .mf-drag-ghost {
    position: fixed;
    top: -100px;
    left: -100px;
    pointer-events: none;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--editor-mergefield-bg);
    border: 1px solid var(--editor-mergefield-border);
    color: var(--editor-mergefield-fg);
    font-size: 13px;
    white-space: nowrap;
  }

  /* Landing pop on the freshly dropped chip (class applied by handleDrop,
     removed on animationend). Subtle by design; off under reduced motion. */
  @media (prefers-reduced-motion: no-preference) {
    .document-editor__surface .merge-field--dropped {
      animation: ${editorChipLand} 220ms ease-out;
    }
  }
`
