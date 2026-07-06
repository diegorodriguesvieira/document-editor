# Theming the editor

The SDK ships a **clean default skin** built with Emotion (`@emotion/react`) —
there are **no .css files**: every style partial is a `*.styles.ts` module next
to its source, aggregated by `src/editor/skin.tsx` and injected once as a
`<Global>`. Descendant selectors from that Global reach everything uniformly:
the React chrome, the ProseMirror-managed document DOM, and the pure-DOM node
views (per-component CSS-in-JS can't reach the last two — the Global can).

## 1. It's built in

`DocumentEditor` mounts the skin automatically — nothing to import. Custom
shells that assemble the exported components themselves (`EditorToolbar`,
`CommentsPanel`, …) render `<EditorSkin />` once near their root; duplicate
mounts are harmless.

The skin's rules are **unlayered** (Emotion injects plain rules), so consumer
overrides compete on normal specificity and source order — Emotion's style tags
are injected at runtime, so equal-specificity app rules loaded earlier lose;
be one class more specific (or use the tokens, which is the supported path).

## 2. Re-skin with tokens (the easy 90%)

The default reads every colour, font and page metric from `--editor-*` custom
properties. Override the ones you care about — unlayered, at `:root` (global) or
on a wrapper (scoped) — and you're done. Each default equals the original value,
so importing the file changes nothing until you override.

```css
/* your app CSS (or an Emotion Global of your own) */
:root {
  --editor-accent: #7c3aed;      /* toolbar active, links, resize handle, affordance */
  --editor-surface: #0f1116;     /* page + popovers + inputs (a dark theme) */
  --editor-text: #e6e6e6;
  --editor-page-width: 720px;    /* a narrower text measure */
}
```

> Popups (context menu, `/` and `@` menus, colour picker, merge-field modal)
> render at `<body>` via portals, so they read tokens from `:root`. Define your
> overrides at `:root` to cover them too. To theme **one** editor instance, set
> the tokens on a wrapper around it — the in-page surface picks them up (portaled
> popups still fall back to `:root`).

### Token reference

| Token | Default | Affects |
|---|---|---|
| `--editor-font` | Roboto, system-ui, … | All editor + popup text |
| `--editor-font-mono` | ui-monospace, … | Code blocks |
| `--editor-text` | `#202124` | Body text, menu items, inputs |
| `--editor-text-muted` | `#5f6368` | Blockquotes, secondary labels |
| `--editor-text-subtle` | `#80868b` | Headings in menus, empty states, quotes |
| `--editor-control-fg` | `#444746` | Toolbar / rail / menu-icon glyphs |
| `--editor-surface` | `#fff` | Popovers, panels, inputs |
| `--editor-border` | `#e0e0e0` | Page + container borders |
| `--editor-border-muted` | `#dadce0` | Inputs, `hr`, blockquote rule |
| `--editor-border-table` | `#c7c7c7` | Table cell borders, affordance line |
| `--editor-subtle-bg` | `#f1f3f4` | Rail hover, table header, `/`-icon chip |
| `--editor-chrome-bg` | `#f8f9fa` | Conditional-block chrome |
| `--editor-accent` | `#1a73e8` | Column-resize handle, "Add header" label, active page-region border |
| `--editor-accent-ink` | `#0b57d0` | Pressed toolbar text, links, active swatch |
| `--editor-accent-bg` | `#d3e3fd` | Pressed toolbar button background |
| `--editor-toolbar-bg` | `#edf2fa` | Formatting toolbar background |
| `--editor-menu-active-bg` | `#edf2fa` | Highlighted `/` item, context-menu hover |
| `--editor-control-hover-bg` | `#e2e7ef` | Toolbar button + colour-swatch hover |
| `--editor-danger` | `#d93025` | "Delete row", remove-region, etc. |
| `--editor-danger-bg` | `#fce8e6` | Danger item hover |
| `--editor-inverse-bg` | `#1b1b1b` | Code block + bubble toolbar |
| `--editor-inverse-fg` | `#e3e3e3` | Text on the above |
| `--editor-inverse-accent` | `#8ab4f8` | Bubble toolbar pressed state |
| `--editor-page-width` | `800px` | Content column width (the text measure), centered in the viewport |
| `--editor-page-min-height` | `calc(100vh - 160px)` | FALLBACK page height. Preferred: set it to `auto` and give `.document-editor` a sized parent (flex column, editor as `flex: 1`) — the SDK's internal chain carries the height to the page, so the footer lands at the bottom for ANY app-header height, no math |
| `--editor-page-padding` | `32px 0 96px` | Vertical breathing room around the content (no paper card — the canvas is the page) |
| `--editor-sticky-offset` | `0px` | Top offset of the sticky toolbar/insert rail — set it to your app header's height |
| `--editor-rail-gutter` | `32px` | Distance between the side rails and the browser edge |
| `--editor-z-popup` | `1000` | Caret popups (`/`, `@`), colour picker, merge-field modal |
| `--editor-z-menu` | `1100` | Right-click context menu |
| `--editor-shadow-sm` | `0 1px 3px …` | Insert-rail shadow |
| `--editor-shadow-pop` | `0 6px 24px …` | Context menu + colour picker shadow |
| `--editor-callout-*` | amber set | Callout block |
| `--editor-mergefield-*` | blue set | Merge-field chip + modal chips |
| `--editor-cond-*` | purple set | Conditional-block condition pill |
| `--editor-comment-*` | amber set | Commented-text highlight |

A handful of one-off values (gradients, a few incidental greys/shadows) stay
literal by design. Ask if you want any of them promoted to a token.

## 3. Structural changes (the class contract)

For anything tokens can't express, target the classes directly (your rule wins
over the layer automatically). These class names are a **stable public contract**
— they're emitted by the components and node views.

**Scoping convention (collision safety):** the skin never styles a bare generic
class. Everything rendered **inside the page** is styled under
`.document-editor__surface` (so a page's own `.comment` or `.callout` never
picks up SDK styles); every **body-portaled surface** (context menu, `/` and
`@` menus, colour picker, merge-field modal) carries the namespace class
`.document-editor-popup` and is styled under it. Editor chrome keeps its
distinctive prefixed names unscoped so exported components keep their skin in
custom layouts too — that exemption covers `.editor-toolbar`, `.insert-dock`,
`.bubble-toolbar`, `.comments-panel` and `.color-swatch`. One
exception to the exception: `.page-affordance` (a generic name worth
protecting) is styled under `.document-editor` — custom shells that skip
`DocumentEditor` should keep that class on their wrapper to retain
shell-scoped chrome. Feature CSS should follow the same convention.

- **Shell:** `.document-editor`, `.document-editor__column`, `.document-editor__zoom` (`--scrolls` while zoom > 1), `.document-editor__scale`, `.document-editor__surface`, `.document-editor__empty-state` (screen-centered overlay, `pointer-events: none`; its children are clickable)
- **Toolbars:** `.editor-toolbar`, `.editor-toolbar__btn` (`[aria-pressed]`, `:disabled`), `.bubble-toolbar__inner`, `.insert-dock`, `.insert-dock__btn` (the fixed bottom dock; shape via `--editor-dock-height`/`--editor-dock-gap`)
- **Document (inside `.document-editor__surface`):** `.ProseMirror`, `h1`–`h3`, `table`/`th`/`td`, `.tableWrapper`, `.column-resize-handle`, `.selectedCell`, `blockquote`, `pre`, `hr`, `img`
- **Menus (portaled to `<body>`):** `.suggestion-popup` (the caret-popup wrapper), `.slash-menu`, `.slash-menu__item` (`[data-active]`), `.slash-menu--empty`, `.context-menu`, `.context-menu__item` (`--danger`)
- **Page regions:** `.page-affordance`, `.doc-region` (`--header`/`--footer`, plus `--editing` while open for editing), `.doc-region__bar`/`__label`/`__remove`/`__content`
- **Empty state:** `.document-editor__empty-state` — a viewport-spanning `position: fixed` overlay (`pointer-events: none`, children clickable). Embedding the editor in a split pane? Restyle it (e.g. `position: absolute` under a positioned wrapper) so it centers over the editor, not the app.
- **Features:** `.callout`, `.merge-field` (`--dropped` landing animation), `.mf-panel*`/`.mf-chip` (`--dragging`), `.mf-drag-ghost` (custom drag image), `.conditional-block*`, `.cond-editor*`, `.comment`, `.comments-panel*`, `.color-swatch`/`.color-picker*`, `.image-resizer` (`--selected`, `__handle--nw/n/ne/w/e/sw/s/se`)

## 4. Skipping the default entirely

The components render plain class names; only `<EditorSkin />` gives them
looks. `DocumentEditor` mounts it automatically — to own ALL styling, assemble
a custom shell from the exported components (skip `DocumentEditor`, don't
render `EditorSkin`) and write your own styles against the class contract
above. The headless `useToolbar` / `useInsertBar` hooks let you replace the
markup too (see `EXTENDING.md`).
