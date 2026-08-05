import { css } from '@emotion/react'

/* Right-side review-comments panel: composer + cards. */
export const commentsPanelStyles = css`
  .comments-panel.comments-panel {
    /* Sticky: the panel rides the scroll while the (tall) gutter aside passes
       by — clear of the editor's sticky header. Consumers wrapping it in
       their own rail need that wrapper to be full-height for the ride. */
    position: sticky;
    top: calc(var(--editor-header-height) + 16px);
    width: 260px;
    max-height: 70vh;
    overflow-y: auto;
    padding: 10px 12px;
    border: 1px solid var(--editor-border);
    border-radius: 10px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }

  /* MUI Tab ships min-width 90 / min-height 48 — three of those overflow the
     260px rail. Compact them to panel scale. */
  .comments-panel__tabs.comments-panel__tabs {
    min-height: 32px;
    margin-bottom: 8px;
  }

  .comments-panel__tabs .MuiTab-root {
    min-height: 32px;
    min-width: 0;
    padding: 4px 8px;
    font-size: 12px;
    text-transform: none;
  }

  .comments-panel__empty {
    font-size: 12px;
    color: var(--editor-text-muted);
  }

  .comments-panel__time {
    font-size: 11px;
    color: var(--editor-text-muted);
    white-space: nowrap;
  }

  /* Visually hidden, screen-reader visible — the mutation announcements. */
  .comments-panel__sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .comments-panel__composer {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }

  .comments-panel__composer-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .comments-panel__composer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .comments-panel__error {
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--editor-danger);
  }

  /* Guidance notice under the composer (e.g. the stale-create "reload"). */
  .comments-panel__notice {
    margin: -4px 0 10px 36px;
    font-size: 12px;
    color: var(--editor-text-muted);
  }

  .comments-panel__list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .comments-panel__card {
    position: relative;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--editor-border);
    border-radius: 8px;
    background: var(--editor-chrome-bg);
  }

  /* The comment whose highlight was clicked in the document. The thick left
     border is the NON-COLOR cue (WCAG 1.4.1) — the tint alone is too subtle
     for low-vision users. */
  .comments-panel__card--active {
    border-color: var(--editor-comment-accent);
    border-left: 3px solid var(--editor-comment-accent);
    background: color-mix(in srgb, var(--editor-comment-bg) 70%, var(--editor-surface));
  }

  /* Doubled class beats MUI ButtonBase's own resets. */
  .comments-panel__card-body.comments-panel__card-body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    padding: 8px;
    border-radius: 8px;
    font: inherit;
    text-align: left;
  }

  .comments-panel__card-body.comments-panel__card-body:hover {
    background: color-mix(in srgb, var(--editor-comment-bg) 55%, var(--editor-surface));
  }

  .comments-panel__card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    /* Clear the corner actions pinned to the card's top-right: one 32px
       IconButton (theme CONTROL_METRICS) + the 4px offset + breathing room —
       otherwise a long author name renders UNDER the transparent button and
       clicks there hit Resolve instead of jumping. */
    padding-right: 40px;
  }

  /* Both corner buttons present (Resolve + 3-dots) — clear them both. */
  .comments-panel__card-header--roomy {
    padding-right: 72px;
  }

  .comments-panel__author {
    font-size: 13px;
    font-weight: 600;
    color: var(--editor-text);
  }

  .comments-panel__text {
    font-size: 13px;
    color: var(--editor-text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* ORPHANED comment (its anchored text was deleted): inert body showing
     the original quote — muted, so it reads as history, not a live target. */
  .comments-panel__card-body--orphan.comments-panel__card-body--orphan {
    cursor: default;
  }

  /* Inert body while EDITING (no jump — a click in the field must not move
     the document) or FROZEN (resolved/archived: read-only, highlight shed),
     and no hover invitation on any of them. */
  .comments-panel__card-body--editing.comments-panel__card-body--editing,
  .comments-panel__card-body--frozen.comments-panel__card-body--frozen {
    cursor: default;
  }

  .comments-panel__card-body--orphan.comments-panel__card-body--orphan:hover,
  .comments-panel__card-body--editing.comments-panel__card-body--editing:hover,
  .comments-panel__card-body--frozen.comments-panel__card-body--frozen:hover {
    background: transparent;
  }

  /* Direct replies (one level), indented under the parent's avatar line. */
  .comments-panel__replies {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0 8px 4px 24px;
    list-style: none;
  }

  .comments-panel__reply {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    /* Clear the 3-dots pinned to the row's top-right corner (32px button). */
    padding-right: 36px;
  }

  .comments-panel__reply-menu.comments-panel__reply-menu {
    position: absolute;
    top: 0;
    right: 0;
  }

  .comments-panel__avatar--small.comments-panel__avatar--small {
    width: 20px;
    height: 20px;
    font-size: 10px;
  }

  .comments-panel__reply-button.comments-panel__reply-button {
    align-self: flex-start;
    margin: 0 0 4px 4px;
  }

  .comments-panel__reply-composer {
    display: flex;
    gap: 8px;
    padding: 0 8px 8px 8px;
  }

  .comments-panel__orphan-quote {
    font-size: 12px;
    font-style: italic;
    color: var(--editor-text-muted);
    overflow-wrap: anywhere;
  }

  .comments-panel__orphan-hint {
    font-size: 11px;
    color: var(--editor-text-muted);
  }

  /* Badge on a card whose anchor is only PARTIALLY live (some segments'
     text was deleted) — quiet, informational. */
  .comments-panel__partial-badge {
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--editor-comment-accent) 20%, transparent);
    font-size: 10px;
    color: var(--editor-text-muted);
    white-space: nowrap;
  }

  /* The per-card anchor sync strip (pendingSave/saving) — sits
     under the card body, outside its ButtonBase. */
  .comments-panel__sync {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 6px;
    font-size: 14px;
    color: var(--editor-text-muted);
  }

  .comments-panel__sync--failed {
    color: var(--editor-danger);
  }

  .comments-panel__sync [role='img'] {
    display: inline-flex;
    align-items: center;
  }

  .comments-panel__retry.comments-panel__retry {
    min-width: 0;
    padding: 0 6px;
    font-size: 11px;
  }

  /* The card's top-right actions: the ✓ Resolve button + the 3-dots. */
  .comments-panel__corner {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    align-items: center;
  }

  .comments-panel__avatar.comments-panel__avatar {
    width: 28px;
    height: 28px;
    font-size: 12px;
  }
`
