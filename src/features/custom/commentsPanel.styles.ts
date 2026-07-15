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

  .comments-panel__title {
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--editor-text);
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
    border: 1px solid var(--editor-border);
    border-radius: 8px;
    background: var(--editor-chrome-bg);
  }

  /* The comment whose highlight was clicked in the document. */
  .comments-panel__card--active {
    border-color: var(--editor-comment-accent);
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
    /* Clear the 3-dots pinned to the card's top-right corner. */
    padding-right: 24px;
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

  .comments-panel__menu.comments-panel__menu {
    position: absolute;
    top: 4px;
    right: 4px;
  }

  .comments-panel__avatar.comments-panel__avatar {
    width: 28px;
    height: 28px;
    font-size: 12px;
  }
`
