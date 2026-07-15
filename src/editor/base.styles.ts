import { css } from '@emotion/react'

/** The FUNCTIONAL marker every body-portaled surface carries — the
 *  header/footer region gate keeps an open region open for clicks inside any
 *  element with this class. Producers interpolate the constant; the
 *  *.styles.ts partials keep literal selectors (pure CSS, fails visibly). */
export const POPUP_CLASS = 'document-editor-popup'

/**
 * Base tokens + reset for the editor SDK skin. Every other partial builds on
 * these '--editor-*' custom properties — override them to theme.
 *
 * ':where(:root)' — specificity ZERO on purpose. The Emotion <Global> injects
 * its <style> at RENDER time, i.e. AFTER any consumer stylesheet loaded via
 * import; with plain ':root' the SDK defaults would re-win the cascade and
 * silently revert every consumer token override (page min-height, sticky
 * offset…). At zero specificity, a consumer's ':root { --editor-*: … }'
 * always wins, whatever the injection order. See THEMING.md.
 */
export const baseStyles = css`
  :where(:root) {
    /* Typography */
    --editor-font: 'Roboto', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
    --editor-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

    /* Text */
    --editor-text: #202124;
    --editor-text-muted: #5f6368;
    --editor-text-subtle: #80868b;
    --editor-control-fg: #444746;

    /* Surfaces & borders */
    --editor-surface: #fff;
    --editor-border: #e0e0e0;
    --editor-border-muted: #dadce0;
    --editor-border-table: #c7c7c7;
    --editor-subtle-bg: #f1f3f4;
    --editor-chrome-bg: #f8f9fa;

    /* Accent (interactive blue) */
    --editor-accent: #1a73e8;
    --editor-accent-ink: #0b57d0;
    --editor-accent-bg: #d3e3fd;
    --editor-menu-active-bg: #edf2fa;
    --editor-control-hover-bg: #e2e7ef;

    /* Danger */
    --editor-danger: #d93025;
    --editor-danger-bg: #fce8e6;

    /* Inverse (dark chrome: code block, bubble toolbar) */
    --editor-inverse-bg: #1b1b1b;
    --editor-inverse-fg: #e3e3e3;
    --editor-inverse-accent: #8ab4f8;

    /* Page: a flat, centered content column on a white canvas (no paper card).
       Width = the text measure; padding is vertical breathing room only.
       min-height ≈ the viewport minus typical app chrome, so a page footer
       lands at the BOTTOM of the screen — tune it to your app's chrome. */
    --editor-page-width: 800px;
    --editor-page-min-height: calc(100vh - 160px);
    --editor-page-padding: 32px 0 96px;

    /* Distance between the side panels and the browser edge. */
    --editor-rail-gutter: 32px;
    /* The editor HEADER bar (shown by default; fill it via renderHeader).
       Fixed height by design — content adapts to the bar, not the reverse. */
    --editor-header-height: 72px;
    /* The editor FOOTER bar (the actions dock): shape + inset from the
       viewport edges. The shell reserves matching clearance below the page. */
    --editor-dock-height: 66px;
    --editor-dock-gap: 8px;

    /* Stacking of floating surfaces. Header and footer sit below them all —
       popups must float above both; MUI-owned surfaces (the context menu)
       stack via the MUI theme's zIndex (1300) higher still. */
    --editor-z-header: 900;
    --editor-z-dock: 900;
    --editor-z-popup: 1000;

    /* Shadows */
    --editor-shadow-sm: 0 1px 3px rgba(60, 64, 67, 0.15);
    --editor-shadow-pop: 0 6px 24px rgba(0, 0, 0, 0.2);

    /* Feature accents */
    --editor-callout-bg: #fef7e0;
    --editor-callout-border: #feefc3;
    --editor-callout-accent: #f9ab00;
    --editor-variable-bg: #e8f0fe;
    --editor-variable-border: #c6dafc;
    --editor-variable-fg: #1967d2;
    --editor-cond-bg: #ece8fd;
    --editor-cond-border: #d5c8f7;
    --editor-cond-fg: #5b3dd4;
    --editor-cond-block-bg: #fafafa;
    --editor-cond-bar-bg: #efefef;
    --editor-comment-bg: #fff3bf;
    --editor-comment-accent: #f59f00;
  }

  /* Self-contained base so the SDK doesn't rely on a global reset. Two roots:
   * '.document-editor' (the shell) and '.document-editor-popup' (the namespace
   * class every body-portaled surface carries — context menu, '/' and '@'
   * menus, colour picker, variables panel). ':where()' keeps specificity 0,
   * so consumers override effortlessly. */
  :where(.document-editor, .${POPUP_CLASS}) {
    box-sizing: border-box;
    font-family: var(--editor-font);
    color: var(--editor-text);
    line-height: 1.5;
  }
  :where(.document-editor, .${POPUP_CLASS}) *,
  :where(.document-editor, .${POPUP_CLASS}) *::before,
  :where(.document-editor, .${POPUP_CLASS}) *::after {
    box-sizing: border-box;
  }

  /* Every body-portaled surface stacks at the popup level; MUI-owned
     surfaces (the context menu) ride the MUI theme's zIndex instead. */
  .${POPUP_CLASS} {
    z-index: var(--editor-z-popup);
  }
`
