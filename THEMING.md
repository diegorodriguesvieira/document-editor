# Theming the editor

The SDK ships a **clean default skin** as one optional stylesheet. It's plain CSS
with **zero runtime** — no CSS-in-JS, no theme provider, nothing to render. It
styles the React chrome, the ProseMirror-managed document DOM, and the pure-DOM
node views uniformly (a CSS-in-JS runtime can't reach the last two).

## 1. Import it

```ts
import '@your-sdk/editor/editor.css' // once, at your app root
```

Everything is wrapped in a single `@layer editor` cascade layer. That's the whole
trick: **any rule you write outside a layer beats the SDK's, regardless of
specificity** — no `!important`, no specificity wars.

## 2. Re-skin with tokens (the easy 90%)

The default reads every colour, font and page metric from `--editor-*` custom
properties. Override the ones you care about — unlayered, at `:root` (global) or
on a wrapper (scoped) — and you're done. Each default equals the original value,
so importing the file changes nothing until you override.

```css
/* your app, unlayered — wins over the layer */
:root {
  --editor-accent: #7c3aed;      /* toolbar active, links, resize handle, affordance */
  --editor-surface: #0f1116;     /* page + popovers + inputs (a dark theme) */
  --editor-text: #e6e6e6;
  --editor-page-width: 794px;    /* A4 @96dpi instead of US Letter */
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
| `--editor-surface` | `#fff` | Page, popovers, panels, inputs |
| `--editor-border` | `#e0e0e0` | Page + container borders |
| `--editor-border-muted` | `#dadce0` | Inputs, `hr`, blockquote rule |
| `--editor-border-table` | `#c7c7c7` | Table cell borders, affordance line |
| `--editor-subtle-bg` | `#f1f3f4` | Rail hover, table header, `/`-icon chip |
| `--editor-chrome-bg` | `#f8f9fa` | Conditional-block chrome |
| `--editor-accent` | `#1a73e8` | Column-resize handle, "Add header" label |
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
| `--editor-page-width` | `816px` | Page width (US Letter @96dpi) |
| `--editor-page-min-height` | `1056px` | Page height (US Letter) |
| `--editor-page-padding` | `96px` | Page margins (1in) |
| `--editor-sticky-offset` | `0px` | Top offset of the sticky toolbar/insert rail — set it to your app header's height |
| `--editor-z-popup` | `1000` | Caret popups (`/`, `@`), colour picker, merge-field modal |
| `--editor-z-menu` | `1100` | Right-click context menu |
| `--editor-shadow-sm` | `0 1px 3px …` | Page + insert-rail shadow |
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
custom layouts too — that exemption covers `.editor-toolbar`, `.insert-rail`,
`.bubble-toolbar`, `.comments-panel`, `.color-swatch` and `.ai-button`. One
exception to the exception: `.page-affordance` (a generic name worth
protecting) is styled under `.document-editor` — custom shells that skip
`DocumentEditor` should keep that class on their wrapper to retain
shell-scoped chrome. Feature CSS should follow the same convention.

- **Shell:** `.document-editor`, `.document-editor__column`, `.document-editor__zoom`, `.document-editor__scale`, `.document-editor__surface`
- **Toolbars:** `.editor-toolbar`, `.editor-toolbar__btn` (`[aria-pressed]`, `:disabled`), `.bubble-toolbar__inner`, `.insert-rail`, `.insert-rail__btn`
- **Document (inside `.document-editor__surface`):** `.ProseMirror`, `h1`–`h3`, `table`/`th`/`td`, `.tableWrapper`, `.column-resize-handle`, `.selectedCell`, `blockquote`, `pre`, `hr`, `img`
- **Menus (portaled to `<body>`):** `.suggestion-popup` (the caret-popup wrapper), `.slash-menu`, `.slash-menu__item` (`[data-active]`), `.slash-menu--empty`, `.context-menu`, `.context-menu__item` (`--danger`)
- **Page regions:** `.page-affordance`, `.doc-region` (`--header`/`--footer`)
- **Features:** `.callout`, `.merge-field`, `.mf-modal`/`.mf-chip`, `.conditional-block*`, `.cond-editor*`, `.comment`, `.comments-panel*`, `.color-swatch`/`.color-picker*`, `.ai-button`

## 4. Skipping the default entirely

The SDK works with **no stylesheet** — components just render with their class
names. If you'd rather own all styling, don't import `editor.css`; write your own
CSS against the class contract above. The headless `useToolbar` / `useInsertBar`
hooks let you replace the markup too (see `EXTENDING.md`).
