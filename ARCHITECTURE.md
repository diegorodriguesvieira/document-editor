# Architecture

This document explains how the editor SDK works **inside** — for developers who
maintain it or build features on it. If you only *consume* the editor
(`<DocumentEditor features={…}/>`), start with `EXTENDING.md`; for the visual
skin, see `THEMING.md`.

## 1. Design stance

Five decisions shape everything else. They were made deliberately — don't
re-litigate them casually:

1. **Committed to TipTap v3 / ProseMirror.** There is no engine-abstraction
   layer and none is planned. The real insurance against a future engine swap
   is **data portability** (the `DocumentJSON` envelope), not code portability.
   The `EditorApi` facade exists for *hygiene* (keeping `@tiptap/*` out of
   product code), not swappability.
2. **Features are data first, code second.** A feature declares its bubble
   buttons, inserts, commands and keybindings as *data* (`defineFeature`); the
   SDK renders and routes them. JSX only appears where a feature genuinely owns
   pixels (node views, custom popovers).
3. **Kernel is minimal and sacred.** The always-on part is only what a document
   cannot exist without (doc/paragraph/text, gap cursor, trailing paragraph).
   Everything else — bold, tables, comments, header/footer — is opt-in.
   Cosmetic fixes never live in the kernel; they live at the presentation
   layer that misbehaves (the "altitude rule").
4. **Fail fast, never wipe.** Feature conflicts throw at boot
   (`resolveFeatures`); content invalid for the active schema throws instead of
   silently emptying the document (`enableContentCheck` + `onContentError`).
5. **The right rail is consumer-owned.** The SDK ships behaviors and reference
   UI (e.g. the comments panel), but placement of side UI belongs to the app.
   There is intentionally *no* "panels channel".

## 2. Mental model

```
FeatureDefinition[]  ──resolveFeatures──►  ResolvedFeatures   (fail-fast merge)
                                            │
              ┌─────────────────────────────┼──────────────────────────┐
              ▼                             ▼                          ▼
      buildExtensions               UI contributions              commands/keymap
  kernel + feature extensions   bubble/inserts/contextMenu/    exec()-routable ids
  + synthetic registryKeymap    pageRegions (rendered by the    + registryKeymap
              │                  shell via RegistryBar etc.)
              ▼
        TipTap Editor  ◄──EditorApi facade──  consumer code / feature UI
              │
              ▼
       <DocumentEditor>  — the shell: grid layout, rails, zoom, render props
```

One sentence: **features declare, the registry validates and merges, the
kernel+extensions become a TipTap editor, and the shell renders chrome around
it — with `EditorApi` as the only surface product code talks to.**

## 3. The core pipeline

### `defineFeature` (`core/defineFeature.ts`, types in `core/types.ts`)

A `FeatureDefinition` is a plain object: `id`, `extensions()` (TipTap
extensions — features are TipTap-native by design), and optional channels:

| Channel | Shape | Rendered by |
|---|---|---|
| `commands` | `id → (editor, payload?) => boolean` | routed via `api.exec(id)` |
| `keymap` | `'Mod-Shift-x' → commandId` | synthetic `registryKeymap` extension |
| `bubble` | `BubbleItem[]` (data; optional `render` escape hatch) | `BubbleBar` / `BubbleToolbar` |
| `insert` | `InsertItem[]` | `InsertToolbar` (bottom insert dock) + mirrored into the `/` slash menu |
| `contextMenu` | `ContextMenuSection[]` | `EditorContextMenu` (all matching sections compose) |
| `pageRegions` | `PageRegion[]` (position, label, addCommandId, nodeName) | `PageAffordances` hover chrome; kernel derives `TrailingNode.notAfter` from `position: 'bottom'` entries |

### `resolveFeatures` (`core/registry.ts`)

Merges the enabled features and **throws at boot** on: duplicate feature ids
with different definitions, missing `dependsOn`, a command id declared twice,
a keyboard shortcut mapped twice, and bubble/insert/keymap items referencing
a command id nobody registered. A broken feature set is a programmer error —
it should never reach users half-working.

### `buildExtensions` (`core/buildExtensions.ts`)

`kernel + resolved.extensions + registryKeymap(resolved)`.

The kernel: `Document`, `Paragraph`, `Text`, `Gapcursor`, `Dropcursor`,
`TrailingNode.configure({ notAfter: bottomRegions })`. Note the inversion: the
kernel never hardcodes a feature's node name — bottom-pinned regions are read
from `pageRegions` metadata.

`registryKeymap` is one synthetic extension that binds every feature keymap
entry to its registered command, keeping keymap ownership in the SDK.

### `baseEditorOptions` (`core/createEditor.ts`)

The single owner of construction policy — content fallback, and
`enableContentCheck: true` with throw-or-callback semantics. Both the headless
`createEditor` (tests, scripts) and the React `useDocumentEditor` spread it, so
policy can't drift between the two paths.

### `useDocumentEditor` (`hooks/useDocumentEditor.ts`)

The React entry point. Three things worth knowing:

- **Editor identity tracks the feature ids (set + order), not the array
  reference.** An inline `features={[Bold, Italic]}` never recreates the
  editor. Corollary: *runtime data must not flow through the features array* —
  it flows through React context (see `DocumentVariablesProvider`), so data
  arriving later fills the UI without remounting the editor.
- **`onChange` is debounced (250 ms)** because `getJSON()` is O(n) — and the
  pending debounce is **flushed on teardown** so the user's last edits are
  never silently dropped. Autosave race handling beyond this point (chaining,
  coalescing, rev/ETag) is the consumer's job — the recipe is in
  `EXTENDING.md` §7.
- The `/` slash menu is created here only when some insert declares a
  `commandId` — it mirrors the insert dock, one source of truth.

## 4. The seam: `EditorApi` / `EditorStateView`

`EditorStateView` is the *read* slice a bar needs (`isActive`, `canUndo`,
`isEmpty`, `isSelectionEmpty`, …). `EditorApi` extends it with document I/O
(`getJSON`/`setJSON`/`getHTML`), `exec(commandId)`, `hasNode`, `focus`, `on`.

`createMockEditor` implements the same interface in memory. That twin is what
makes bar and feature wiring testable without a real ProseMirror instance
— and it is a *compile-time* pressure: anything added to the interface must be
mockable, which keeps the seam honest and thin.

Escape hatch: render contexts also expose the raw `editor` (typed non-null in
`DocumentEditorRenderContext`) for things the thin view deliberately doesn't
model (e.g. `editor.schema.nodes` probing, `editor.can()`).

## 5. The shell: `<DocumentEditor>`

`components/DocumentEditor.tsx` + `DocumentEditor.styles.ts`.

- **Layout** is a 3-column grid: `minmax(min-content,1fr) | minmax(0,
  --editor-page-width) | minmax(min-content,1fr)`. Rails pin to the browser
  edges at `--editor-rail-gutter`; the 800px content column centers on the
  *viewport* (not on "whatever is left"), which is what makes the flat,
  paper-less design read correctly.
- **Page height flows through a flex chain** (`__column → __zoom → __scale →
  __surface → .ProseMirror`, all `flex: 1 0 auto`). A consumer that gives
  `.document-editor` a sized parent gets a page that fills "viewport minus
  whatever chrome the app has" with **zero math** — that's how the footer
  lands at the bottom for any app-header height. `--editor-page-min-height` is
  only the fallback for unsized parents. Breaking ONE link strands the page
  height — the chain is grouped under a single CSS selector on purpose.
- **MUI chrome layer**: interactive chrome (menus, popovers, buttons, forms)
  is Material UI 7 under a scoped `ThemeProvider` (`src/editor/theme.tsx`;
  `muiTheme` prop). The theme's palette literals mirror the `--editor-*` token
  defaults (pinned by `theme.contract.test.ts`) and every visible knob reads
  `var(--editor-x, <default>)`, so token overrides keep restyling MUI chrome.
  Portal/dismiss split: the context menu is a fully MUI-owned Menu (it joins
  the Escape stack via `useEscapeSurface`); the color picker and variables
  panel are NON-modal Poppers with `useDismissable` as dismiss owner (no
  backdrop — chip dragging and the region gate depend on it); suggestion
  popups keep their TipTap-owned lifecycle with MUI visuals only. Every
  portaled surface carries `document-editor-popup` on its paper/root.
- **`editable={false}` (read-only)**: `setEditable` live — never a recreation
  (undo/scroll survive the toggle; a no-op dispatch nudges the transaction
  subscribers, which is what React node views listen to). The SDK hides its
  mutating chrome (default insert actions, page affordances, context menu,
  node-view controls); `api` stays fully able — read-only gates UI, not API.
- **Render-prop ladder**: `renderBubble`, `renderHeader` / `renderFooter`
  (fixed-height SDK shells, consumer content; returning null HIDES the bar —
  the footer defaults to the insert actions), `renderLeftPanel` /
  `renderRightPanel` (consumer-owned gutters, render anything — including the
  headless `InsertToolbar` if the inserts should live in a panel instead of
  the dock), `renderEmptyState` (screen-centered
  `position: fixed` overlay, `pointer-events: none` with clickable children,
  shown only while the document is BLANK — `api.isEmpty`, one empty
  paragraph; deliberately NOT TipTap's "no text" semantics). Each receives the same
  `DocumentEditorRenderContext { editor, api, resolved }`.
- `RegistryBar` (internal, not exported) is the one rendering pipeline behind
  `BubbleBar` and `InsertToolbar` — item filtering, disabled state via
  `EditorStateView`, custom `render` escape hatch. Skins differ; wiring
  doesn't.

## 6. Reactivity and state rules

- **`useFeatureState(editor, selector)`** (`hooks/useFeatureState.ts`) is the
  seam feature UI reads editor state through (only it and `useBar`, which
  predates it, touch TipTap's `useEditorState` directly). Same
  selector+equality optimization, single point of coupling.
- **Extension `storage`** is for feature-internal shared state (e.g. which
  region is open for editing). Rules learned the hard way: keep ONE source of
  truth (derive React state from storage via `useFeatureState`, never mirror
  it into `useState`); every storage mutation must be followed by a dispatch
  so derived state refreshes; and tie its lifecycle to the document (clear it
  when the thing it points at disappears — undo, `setJSON`, node removal).
- **Runtime data → context providers**, never the features array (identity —
  see §3). `DocumentVariablesProvider` is the reference implementation.
- Typed storage access uses one confined cast per feature (a local accessor
  function), **never** global declaration merging — merging would lie about
  editors that don't enable the feature.

## 7. Interaction machinery

- **`useDismissable(refs, onClose, opts)`** owns the dismiss contract for every
  floating surface (context menu, color picker, variables panel, open
  header/footer regions). Three hard-won details live inside it:
  - *Capture-phase listeners.* ProseMirror `preventDefault`s Escape inside the
    editable — a bubble-phase listener starves. Mousedown is capture for the
    same reason.
  - *Escape closes innermost-first* via a module-level stack: capture order on
    `document` is registration order, so without the stack a long-lived
    surface would swallow the Escape meant for a popover opened after it.
  - *`isOutsideClick`* lets a surface narrow its exit rule (the header/footer
    region stays open for toolbar/popover clicks — see §8).
- **`createSuggestionPopup`** owns the `@`/`/` popup lifecycle (positioning,
  keyboard navigation, portal). Portals carry the
  `.document-editor-popup` class — that's both the CSS scope and the marker
  other machinery (like `isOutsideClick` rules) can rely on.

## 8. Feature anatomy — case studies

Features live in `src/features` and reach the SDK only through the public
barrel. Three of them are deliberately "reference implementations":

### `headerFooter.tsx` — the full toolkit

The richest feature; if you build region-like behavior, copy from here.

- **Nodes**: `documentHeader`/`documentFooter` are singleton `block+` nodes,
  `defining` + `isolating`, serialized as `data-document-header/footer` divs —
  the backend contract (regions travel *inside* the `{doc}` envelope; the PDF
  renderer repeats them per page). Node names appear once (`REGION_TOP/BOTTOM`
  consts) and flow into the `pageRegions` metadata.
- **Guard extension** (`HeaderFooterGuard`) — one plugin, several duties:
  - `filterTransaction`: rejects the *lying gap cursor* above the header /
    below the footer (typing there would create content the normalizer
    instantly reorders — a cursor that lies is worse than no cursor).
  - `appendTransaction` (normalizer): at most one header (first), one footer
    (last), extras dropped; body always keeps ≥ 1 block (restored empty
    paragraph after a full-body delete); stale editing gate cleared when the
    open region disappears.
  - `appendTransaction` (selection gate): regions are entered by
    **double-click only**. Any selection landing inside a *closed* region —
    arrow keys, shift-selection, load-time selection — is clamped back to the
    body. The open region's name lives in the extension storage; the node
    view's `editing` state *derives* from it. A doc change that strands the
    caret outside the open region (e.g. deleting all its content makes
    `Selection.near` cross the isolating boundary) pulls the caret back in.
- **`RangeSelection`** (AllSelection-style `Selection` subclass): the scoped
  Cmd+A. `TextSelection` endpoints must be inline positions, which silently
  *excludes* edge atoms (a leading image) — Delete would leave them alive.
  `RangeSelection` anchors on node boundaries and degrades to a
  `TextSelection` after any doc change. Registered with `Selection.jsonID`
  (HMR-guarded).
- **Node view** (`HeaderFooterView`): suppresses single-click caret entry
  (`preventDefault` on mousedown when closed), opens on double-click (gate
  first, *then* caret — order matters or the gate bounces it), label bar
  swallows mousedown (non-editable chrome inside a node view must, or it blurs
  the caret), exit via `useDismissable` with a positive `isOutsideClick` rule:
  only editor *controls* (buttons/selects/inputs in the shell, portaled
  popups) keep the region open — document, canvas and app-chrome clicks close
  it.

### `conditionalBlock.tsx` — the rejector idiom

Nested conditions (nesting = AND) with a hard depth cap of 5.
`ConditionalDepthGuard` uses `filterTransaction` to *reject* any transaction
whose resulting doc exceeds the cap — paste, drag, `setJSON`, anything. The
document can never be invalid, nothing is silently rewritten, and the ＋
affordance simply no-ops at the limit. Contrast with the header/footer
*normalizer*: *reject* when the input is the user's (they should feel the
no-op), *normalize* when malformed content arrives from outside (loads,
pastes) and a canonical shape exists.

### `comments.ts` + `commentsPanel.tsx` — behavior/UI split

The mark + storage + click-to-scroll behavior is the feature;
`CommentsPanel` is *reference UI* and `useDocumentComments` is the data hook a
consumer rebuilds UI on (the demo's `CommentCards` proves the rewrite path).
This is the pattern that replaced the deleted "panels channel".

## 9. CSS architecture (Emotion, no .css files)

- The skin is Emotion: every component/feature owns a `*.styles.ts` (a
  module-scope `css` template) next to its `.tsx`; `editor/skin.tsx` aggregates
  them in cascade order into one `<Global>` (`EditorSkin`), which
  `DocumentEditor` mounts automatically (custom shells render it once).
- Rules are UNLAYERED (the old `@layer editor` contract is gone): consumer
  overrides compete on normal specificity/source order; the supported theming
  path is the `--editor-*` tokens.
- Performance rules that keep Emotion invisible: every template lives at
  module scope (serialized once); high-frequency values (panel position,
  resize/zoom) stay in inline `style`; pure-DOM node views (variable chip)
  stay pure — they're styled by the Global's descendant selectors, never
  converted to styled/React.
- Tokens (`--editor-*`) are the theming contract; `THEMING.md` is the
  authoritative table (including the class-name contract — those names are
  public API and what the imperative class toggles/tests rely on).
- Scoping convention: in-page UI under `.document-editor__surface`, portals
  carry `.document-editor-popup`.
- Gap-cursor overrides still beat TipTap's runtime-injected unlayered CSS —
  now via higher specificity (`.document-editor__surface .ProseMirror-gapcursor`),
  since the whole skin is unlayered anyway.

## 10. Persistence & backend contract

- `DocumentJSON = { doc: JSONContent }` — the persistable envelope
  (`core/document.ts`). Commit to data portability, not engine portability.
- `getHTML()` output carries the backend contract in `data-*` attributes:
  regions (`data-document-header/footer`), conditional blocks
  (`data-conditional-block` + `data-condition` carrying the condition JSON —
  an all/any tree of `{op, params}` comparisons with typed operands; operator
  ids like `EQUALS`/`GREATER_THAN` are protocol constants. Full grammar,
  coercion and error policy: `CONDITION-FORMAT.md`).
- `setJSON` **throws** on content invalid for the active schema. Templates
  must therefore be built against `editor.schema.nodes` (which features are
  enabled), not `api.hasNode` (which asks the current *document*) — reference:
  `src/app/contractTemplate.ts`.

## 11. Selection pitfalls (read before touching selection code)

These cost real debugging time; they're encoded in code comments too:

- **Point selections**: use `TextSelection.between`. Raw node-boundary
  positions (`$pos.end(depth)` after a `</p>`) are unrepresentable in the
  contenteditable; the next `focus()`'s DOM roundtrip **collapses** the
  selection (symptom: bubble disappears after a toolbar command).
- **Range select-all**: the opposite — `TextSelection` *skips* edge atoms; use
  the `RangeSelection` idiom (node-boundary endpoints).
- `.ProseMirror img` matches ProseMirror's own `ProseMirror-separator` caret
  hack — filter by class when probing the DOM.
- `isolating` nodes trap Backspace/Delete at their boundaries in *both*
  directions; pair them with explicit keyboard handlers (see
  `conditionalBlock`'s empty-line handling) and expect the gap cursor to be
  the way in/out of tight spots.
- TipTap's `commands.keyboardShortcut` replays only *steps*, dropping
  selection changes — tests for selection-changing shortcuts must dispatch a
  real `KeyboardEvent` on `view.dom`.

## 12. Testing strategy

Two supported modes (`src/test/editorHarness.ts`):

1. **Headless-mock** (`createMockEditor`): bar/wiring logic, no DOM.
2. **Real editor in jsdom** (`renderEditor`): schema, commands, guards,
   keymaps. The harness auto-destroys via `onTestFinished` — no manual
   cleanup, and cleanup is registered *before* creation so a throwing test
   still tears down.

Culture: jsdom proves state logic; anything involving focus, mouse geometry,
selection painting or CSS is verified in a real browser (the repo's history is
full of headless-vs-headed surprises — e.g. the Cmd+A collapse only reproduced
with real clicks). If a behavior matters, it gets both a unit test and a
browser pass.

Dev trap: **Vite HMR never recreates the editor** — ProseMirror extensions,
commands and plugins stay stale after editing feature files. Full page reload
before judging behavior.

## 13. Document map

| Doc | Audience |
|---|---|
| `README.md` | first contact — what this is, how to run it |
| `EXTENDING.md` | consumers: channels, recipes, right rail, autosave, testing |
| `THEMING.md` | designers/consumers: tokens, class contract, layering |
| `ARCHITECTURE.md` | this file — maintainers and feature authors |

`src/app` is a living example gallery (custom bar items via
`appExtras.tsx`, rewritten comments UI via `CommentCards.tsx`, schema-aware
templates via `contractTemplate.ts`) — treat it as executable documentation,
not product code.
