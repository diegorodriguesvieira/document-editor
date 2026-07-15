# Extending the editor

The editor is an opt-in **feature SDK**. As a consuming team you ship
capabilities as `defineFeature` objects passed to `<DocumentEditor features={[…]} />`
— you never edit SDK files.

**The one rule:** your *app* code imports from the SDK (`../editor`,
`../features`), never `@tiptap/*` directly — a test fails if the engine leaks
into the app. **Features are TipTap-native by design:** import the common
building blocks from `../editor` (its `authoring` surface re-exports them) and
reach into `@tiptap/*` freely for anything else (ProseMirror plugins, model
types…).

---

## 1. Mount it

```tsx
import { DocumentEditor } from '../editor'
import { BoldFeature, ItalicFeature, HeadingFeature } from '../features'

<DocumentEditor features={[BoldFeature, ItalicFeature, HeadingFeature]} />
```

`features` is just an array — compose your own set (or spread an existing one
and add to it: `features={[...base, MyFeature]}`). Editor identity tracks the
feature *ids*, so an inline array is safe.

Configurable features ship as factories with a zero-config default. The color
picker's palette, for example:

```tsx
import { createColorFeature } from '../features'

const BrandColor = createColorFeature({ palette: ['#0a2540', '#635bff', '#00d4ff'] })
<DocumentEditor features={[…, BrandColor]} />
```

Options are composition-time config — pick them when you build the array
(identity is keyed by feature ids, so a same-id swap at runtime is ignored).

Zoom is a controlled prop — the SDK owns the scaling mechanics (CSS zoom,
in-column scrolling past 100%, chrome staying put); you own the number. The
`useZoom()` hook ships the state and policy (clamping, stepping, float-safe
rounding) so your UI is just buttons:

```tsx
const { zoom, zoomIn, zoomOut, canZoomIn, canZoomOut } = useZoom() // 0.5–2 by 0.1
<button onClick={zoomIn} disabled={!canZoomIn}>+</button>
<DocumentEditor features={…} zoom={zoom} />
```

## 2. The feature contract at a glance

```ts
defineFeature({
  id: 'myFeature',              // stable unique id
  dependsOn: ['otherFeature'],  // must be enabled together (boot-time check)
  extensions: () => [MyNode],   // TipTap extension(s); [] for UI-only features
  commands: { 'myFeature.run': (editor, payload) => boolean },
  keymap: { 'Mod-Shift-y': 'myFeature.run' },
  bubble: [/* BubbleItem[] — the selection bubble menu */],
  insert: [/* InsertItem[] — bottom insert dock; `/` menu mirrors runnable ones */],
  contextMenu: [/* ContextMenuSection[] — right-click */],
  pageRegions: [/* PageRegion[] — header/footer-style page chrome */],
})
```

Everything is validated at boot: duplicate command ids, keymap conflicts,
missing `dependsOn` and dangling `commandId` references all **throw** with a
clear message — a button can't render enabled and silently no-op.

## 3. Bubble / insert items

```tsx
bubble: [{
  id: 'my', group: 'marks', order: 10, label: 'My action', icon: '✦',
  commandId: 'myFeature.run',
  isActive:   (s) => s.isActive('myNode'),
  isDisabled: (s) => s.isSelectionEmpty(), // declarative disabled state
}]
```

- `group` is a data hint the host can filter on (conventional values:
  `'marks' | 'blocks' | 'history' | 'actions'`); `order` interleaves buttons
  across teams deterministically.
- `isActive`/`isDisabled` read the engine-agnostic state view
  (`isActive / canUndo / canRedo / isEmpty / isSelectionEmpty`) — they work
  against a real editor or `createMockEditor` alike.
- **Bubble menu:** `bubble` contributions appear in the bubble automatically
  (the consumer may filter, e.g. `filter={(i) => i.group !== 'history'}`).
- **Payloads:** the default button calls `api.exec(commandId)` with *no*
  payload. For a fixed set of variants, mint one command id per variant (see
  HeadingFeature's `heading.h1/h2/h3`). For arbitrary input (a color, a URL),
  ship a custom control via `render` and call `api.exec(id, payload)` yourself
  — `exec` THROWS on an id no enabled feature registered (a typo can't silently
  no-op) and returns `false` only for "registered but didn't apply"; to probe
  availability, keep your `resolveFeatures(features)` result and check
  `id in resolved.commands`
  (see ColorFeature) — that's what `CommandFn`'s `payload` argument is for.

## 4. A custom control (`render`) + floating surfaces

```tsx
bubble: [{ id: 'my', label: 'My picker', render: ({ editor, api }) => <MyControl api={api} /> }]
```

The chrome is Material UI — `DocumentEditor` mounts a scoped `ThemeProvider`
(see the `muiTheme` prop / THEMING.md), and React context crosses every portal,
so your control can use MUI components directly. Two house rules for FLOATING
surfaces:

1. **Carry the marker class.** Every body-portaled surface must have
   `document-editor-popup` on its PAPER/root (e.g.
   `slotProps={{ paper: { className: 'document-editor-popup my-popover' } }}`),
   never on a backdrop — the header/footer region gate reads it to keep an
   open region open for clicks inside your popover.
2. **Pick the right primitive.** MUI's modal surfaces (Menu/Popover/Dialog)
   trap focus and backdrop-block the page — fine for click-scoped actions (the
   context menu). Anything that must coexist with typing, selection or chip
   DRAGGING is NON-modal — use the SDK's `PopupShell`, which owns the whole
   non-modal contract (Popper portal + Paper, the marker class on the root,
   `useDismissable` with the trigger counted as "inside"):

```tsx
import { PopupShell, useEscapeSurface } from '../editor'

<PopupShell anchorEl={buttonRef.current} open={open} onClose={() => setOpen(false)}
            surfaceClassName="my-popover" role="dialog" ariaLabel="My popover">
  …
</PopupShell>

// Modal MUI surface instead (its own Escape/outside-click): tell the SDK's
// Escape stack to YIELD while it's open, or an open region closes in its place.
useEscapeSurface(open)
```

(The color picker, the variables panel and the prompt forms all ride
`PopupShell`; `useDismissable` stays exported for surfaces that need the raw
hook.)

For caret popups triggered by a character (like `/` and `@`), use
`createSuggestionPopup` + `useListKeyboardNav` — see `variableSuggestion.tsx`
for a ~20-line example (render MUI `Paper`/`MenuItem` inside, but NEVER a
focusing Menu: focus must stay in ProseMirror so typing keeps filtering).
Note: suggestion popups need a React-mounted editor (`useDocumentEditor` +
`EditorContent`), not the headless `createEditor`.

## 5. Context menu (right-click)

```tsx
contextMenu: [{
  id: 'myNode',
  when: (s) => s.isActive('myNode'),      // engine-agnostic state view
  groups: [{ id: 'actions', label: 'My node', items: [
    { id: 'del', label: 'Delete', commandId: 'myFeature.delete', danger: true,
      isAvailable: (editor) => editor.can().deleteNode('myNode') },
  ]}],
}]
```

Every matching section from every feature is shown (registration order) — two
features can both own the clicked spot. `isAvailable` receives the raw editor
(deliberately: `editor.can()` probes aren't expressible on the thin state view).

## 6. Page regions & the side panels

```tsx
// Page-edge chrome with a hover "add" affordance (see HeaderFooterFeature):
pageRegions: [{ id: 'header', position: 'top', label: 'Add header',
                addCommandId: 'header.add', nodeName: 'documentHeader' }]
```

**Editing semantics (Google-Docs style):** a region is entered by DOUBLE-click
only — single clicks, arrow keys and shift-selection can't move the caret in.
The moving parts, if you build your own region-like feature: an extension
storage gate that names the open region (opened BEFORE focusing into it), an
`appendTransaction` that clamps any selection landing in a closed region back
to the body, and a node view that `preventDefault`s single-click mousedown and
activates on double-click. `HeaderFooterFeature`
(`src/features/custom/headerFooter.tsx`) is the reference implementation.

**Empty state:** `renderEmptyState={(ctx) => <YourEmptyState/>}` renders your
UI centered on the screen while the document is empty and removes it at the
first content. The overlay is `pointer-events: none` (clicks reach the editor);
your children are clickable — e.g. a "start from template" CTA calling
`ctx.api.setJSON(template)`.

Build templates against the SCHEMA, not assumptions: `setJSON` throws on nodes
whose feature is disabled (see §7), so probe before emitting each block —
`const has = (name) => Boolean(ctx.editor.schema.nodes[name])`. Note the
distinction: `api.hasNode(name)` asks the current *document*;
`ctx.editor.schema.nodes[name]` asks the enabled *feature set*. Reference
consumer example: `src/app/contractTemplate.ts`.

**Both side gutters are consumer-owned** — render anything in them via
`renderLeftPanel` / `renderRightPanel`. The insert items themselves can move
into a panel: `InsertToolbar` is headless (a `className` replaces the fixed
dock skin), so pair it with a suppressed dock —

```tsx
<DocumentEditor
  features={…}
  renderFooter={() => null}  // no footer
  renderLeftPanel={(ctx) => <InsertToolbar {...ctx} className="my-side-inserts" />}
/>
```

**Read-only mode** is a first-class prop: `editable={false}` keeps the full
layout but rejects typing, and the SDK hides its own mutating chrome — the
default insert actions, the page-region affordances, the context menu and the
node-view controls (conditional-block bar buttons, region Remove, image resize
handles); the bubble already only shows on an editable selection. It is
live-toggleable (a preview/edit switch) without recreating the editor — undo
history and scroll survive. A consumer `renderFooter` owns its own gating.
Programmatic `api.exec`/`api.setJSON` stay available — the prop gates the UI,
not the API.

Comments ship both a default panel and the data hook, so you
can drop the panel in as-is or rebuild the UI without losing behavior:

```tsx
import { CommentsPanel, useDocumentComments } from '../features'

// Default UI:
<DocumentEditor features={…}
  renderRightPanel={(ctx) => <CommentsPanel editor={ctx.editor} />} />

// …or your own UI on the same reactive data (click-to-scroll included):
function MyComments({ editor }) {
  const comments = useDocumentComments(editor) // [{ id, text, quote, from, to }]
  return comments.map((c) => (
    <button key={c.id} onClick={() =>
      editor?.chain().focus().setTextSelection({ from: c.from, to: c.to }).scrollIntoView().run()
    }>{c.text}</button>
  ))
}
```

## 7. Save & load

```tsx
<DocumentEditor
  features={…}
  onChange={(doc) => save(doc)}   // debounced; `doc` is { doc: <ProseMirror JSON> }
  onReady={(api) => fetchDoc().then((d) => api.setJSON(d))}  // async load, no remount
/>
```

The persisted shape is `{ doc }` (ProseMirror JSON — portable). The `api`
surface: `getJSON / setJSON / getHTML / hasNode / focus / exec(commandId, payload?)
/ isActive / canUndo / canRedo / isEmpty / isSelectionEmpty
/ on('update' | 'selection')`.
Loading content whose feature is disabled **throws** — synchronously, from
`api.setJSON` itself, so try/catch the async-load pattern above
(`onContentError` covers initial content and insertContent-style flows, not
`setJSON`). It won't silently wipe
the document).

Feature commands holding a raw ProseMirror doc can share `api.hasNode`'s
definition via the exported `hasTopLevelNode(doc, name)` — one meaning of
"the document has a header", not two.

### Autosave and race conditions — who does what

**The SDK guarantees:** `onChange` fires with a consistent snapshot of the
latest state (serialized at fire time, never a torn intermediate), debounced
250ms, and a pending debounce is **flushed on unmount** so the user's last
edits are never silently dropped. Two things it deliberately does NOT do:

- **Loads echo.** `api.setJSON(...)` in `onReady` triggers `onChange` with the
  document you just loaded. Guard it (skip the first change, or a `loading`
  flag) if re-saving a fresh load bothers your backend.
- **The network is yours.** Debounce limits *frequency*, not *ordering* — on a
  slow connection an older save can resolve after a newer one. The minimal
  safe pattern is chain-and-coalesce (never two saves in flight, always end on
  the newest):

```ts
let inFlight = false
let dirty: DocumentJSON | null = null

async function pump() {
  if (inFlight || !dirty) return
  inFlight = true
  const doc = dirty
  dirty = null
  try {
    await save(doc)
  } finally {
    inFlight = false
    pump() // anything that arrived meanwhile goes out now
  }
}

<DocumentEditor onChange={(doc) => { dirty = doc; pump() }} … />
```

With more than one writer (two tabs, two users), add server-side optimistic
concurrency (a `rev`/ETag with `If-Match` → conflicts become a 409 instead of
a silent clobber). Real-time co-editing is a different animal (CRDT/Yjs) and
out of scope here.

## 8. Runtime data (variable-chip / conditional variables)

Variables come from **you** via context, not the `features` list — so loading
them async doesn't recreate the editor:

```tsx
import { DocumentVariablesProvider } from '../features'

<DocumentVariablesProvider variables={vars}>
  <DocumentEditor features={…} />
</DocumentVariablesProvider>
```

Backend-contract values are exported for whoever renders the document:
`MAX_CONDITIONAL_DEPTH`, `ConditionId`, `Condition`/`ConditionLeaf`/
`ConditionOperand`, `CONDITION_SIGNATURES` (operator arity table),
`isCompleteCondition` (the publish gate), `CommentThread`, `AnchoredComment`.
The condition grammar, coercion rules and error policy live in
`CONDITION-FORMAT.md`.

## 9. Styling your feature

Ship a `myFeature.styles.ts` next to your feature (an Emotion `css` template at
module scope — serialized once, never built inside a render) and register it in
the skin aggregator (`src/editor/skin.tsx` SKIN array), or mount your own
`<Global styles={myFeatureStyles} />` once. Follow the skin's conventions
(they're what keeps consumer pages collision-free, see THEMING.md):

```ts
/* myFeature.styles.ts */
import { css } from '@emotion/react'

export const myFeatureStyles = css`
  .document-editor__surface .my-node {    /* in-page content: scope under the surface */
    background: var(--editor-subtle-bg);  /* build on the --editor-* tokens */
  }
  /* Body-portaled UI: put 'document-editor-popup' in the root's className,
     then style the ROOT with a compound selector and children as descendants: */
  .document-editor-popup.my-popover { … }
  .document-editor-popup .my-popover__item { … }
`
```

Keep dynamic, high-frequency values (positions, sizes mid-drag) in inline
`style` props — never interpolated into the Emotion template.

## 10. Testing your feature

```ts
// paths relative to src/features/custom/ — adjust to where your feature lives
import { renderEditor, docWith, jsonHasNode } from '../../test/editorHarness'
import { createMockEditor, resolveFeatures, BubbleBar } from '../../editor'

// Real editor (schema, commands, serialization) — auto-destroyed per test:
const { api } = renderEditor([MyFeature], { content: docWith('hello') })
expect(api.exec('myFeature.run')).toBe(true)
expect(jsonHasNode(api.getJSON().doc, 'myNode')).toBe(true)

// Bar wiring — no ProseMirror at all:
const mock = createMockEditor({ active: ['myNode'] })
render(<BubbleBar editor={null} api={mock.api} resolved={resolveFeatures([MyFeature])} />)
// click → assert mock.execCalls
```

## Swapping the bubble (optional)

The formatting surface is the selection bubble (`BubbleToolbar`) — the product
has no static formatting bar. `DocumentEditor` takes render props for full
control while still driving off the same registry data (e.g. to filter the
bubble):

```tsx
<DocumentEditor
  features={…}
  renderBubble={(ctx) => <BubbleToolbar {...ctx} filter={(i) => i.group !== 'history'} />}
  renderFooter={(ctx) => <InsertToolbar {...ctx} />}   // keep the shell, swap the content
/>
```

Or build a totally custom bar on the headless `useBubbleBar(editor, api, resolved)`
hook — it returns live `{ item, active, disabled, run }` buttons and you own
every pixel of markup. You never lose the registry — only the markup changes.
