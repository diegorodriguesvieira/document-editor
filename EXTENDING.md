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

## 2. The feature contract at a glance

```ts
defineFeature({
  id: 'myFeature',              // stable unique id
  dependsOn: ['otherFeature'],  // must be enabled together (boot-time check)
  extensions: () => [MyNode],   // TipTap extension(s); [] for UI-only features
  commands: { 'myFeature.run': (editor, payload) => boolean },
  keymap: { 'Mod-Shift-y': 'myFeature.run' },
  toolbar: [/* ToolbarItem[] — top bar AND bubble menu */],
  insert: [/* ToolbarItem[] — left rail; `/` menu mirrors runnable ones */],
  contextMenu: [/* ContextMenuSection[] — right-click */],
  pageRegions: [/* PageRegion[] — header/footer-style page chrome */],
  panels: [/* PanelContribution[] — side panels next to the page */],
})
```

Everything is validated at boot: duplicate command ids, keymap conflicts,
missing `dependsOn` and dangling `commandId` references all **throw** with a
clear message — a button can't render enabled and silently no-op.

## 3. Toolbar / insert items

```tsx
toolbar: [{
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
- **Bubble menu:** toolbar contributions appear in the bubble automatically
  (the consumer may filter, e.g. `filter={(i) => i.group !== 'history'}`).
- **Payloads:** the default button calls `api.exec(commandId)` with *no*
  payload. For a fixed set of variants, mint one command id per variant (see
  HeadingFeature's `heading.h1/h2/h3`). For arbitrary input (a color, a URL),
  ship a custom control via `render` and call `api.exec(id, payload)` yourself
  (see ColorFeature) — that's what `CommandFn`'s `payload` argument is for.

## 4. A custom control (`render`) + dismissable popovers

```tsx
toolbar: [{ id: 'my', label: 'My picker', render: ({ editor, api }) => <MyControl api={api} /> }]
```

For a popover/panel that must close on outside-click and Escape, use the SDK's
dismiss hook instead of hand-rolling listeners:

```tsx
import { useDismissable } from '../editor'

const ref = useRef<HTMLDivElement>(null)
useDismissable(ref, () => setOpen(false), { closeOnScroll: true })
```

(Pass an array of refs to also count the toggle button as "inside".) For caret
popups triggered by a character (like `/` and `@`), use
`createSuggestionPopup` + `useListKeyboardNav` — see `mergeFieldSuggestion.tsx`
for a ~20-line example. Note: suggestion popups need a React-mounted editor
(`useDocumentEditor` + `EditorContent`), not the headless `createEditor`.

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

## 6. Page regions & side panels

```tsx
// Page-edge chrome with a hover "add" affordance (see HeaderFooterFeature):
pageRegions: [{ id: 'header', position: 'top', label: 'Add header',
                addCommandId: 'header.add', nodeName: 'documentHeader' }]

// A side panel next to the page (see CommentsFeature — zero consumer wiring):
panels: [{ id: 'myPanel', render: ({ editor, api }) => <MyPanel editor={editor} /> }]
```

Panels render in the right rail automatically. A consumer replacing the rail
via `renderRightBar` keeps them by dropping `<FeaturePanels {...ctx} />`
wherever they fit.

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
Loading content whose feature is disabled **throws** (it won't silently wipe
the document).

## 8. Runtime data (merge-field / conditional variables)

Variables come from **you** via context, not the `features` list — so loading
them async doesn't recreate the editor:

```tsx
import { DocumentVariablesProvider } from '../features'

<DocumentVariablesProvider variables={vars}>
  <DocumentEditor features={…} />
</DocumentVariablesProvider>
```

Backend-contract values are exported for whoever renders the document:
`MAX_CONDITIONAL_DEPTH`, `ConditionId`, `ConditionValue`, `CommentThread`,
`AnchoredComment`.

## 9. Styling your feature

Ship your own CSS file and import it from your feature module — **never edit
`editor.css`**. Follow the skin's conventions (they're what keeps consumer
pages collision-free, see THEMING.md):

```css
/* myFeature.css */
@layer editor {                           /* consumers out-cascade you for free */
  .document-editor__surface .my-node {    /* in-page content: scope under the surface */
    background: var(--editor-subtle-bg);  /* build on the --editor-* tokens */
  }
  /* Body-portaled UI: put `document-editor-popup` in the root's className,
     then style the ROOT with a compound selector and children as descendants: */
  .document-editor-popup.my-popover { … }
  .document-editor-popup .my-popover__item { … }
}
```

## 10. Testing your feature

```ts
// paths relative to src/features/custom/ — adjust to where your feature lives
import { renderEditor, docWith, jsonHasNode } from '../../test/editorHarness'
import { createMockEditor, resolveFeatures, EditorToolbar } from '../../editor'

// Real editor (schema, commands, serialization) — auto-destroyed per test:
const { api } = renderEditor([MyFeature], { content: docWith('hello') })
expect(api.exec('myFeature.run')).toBe(true)
expect(jsonHasNode(api.getJSON().doc, 'myNode')).toBe(true)

// Toolbar wiring — no ProseMirror at all:
const mock = createMockEditor({ active: ['myNode'] })
render(<EditorToolbar editor={null} api={mock.api} resolved={resolveFeatures([MyFeature])} />)
// click → assert mock.execCalls
```

## Swapping the whole toolbar (optional)

`DocumentEditor` takes render props for full control while still driving off
the same registry data:

```tsx
<DocumentEditor
  features={…}
  renderToolbar={(ctx) => <EditorToolbar {...ctx} filter={(i) => i.group !== 'history'} />}
  renderInsertBar={(ctx) => <InsertToolbar {...ctx} />}
/>
```

Or build a totally custom bar on the headless `useToolbar(editor, api, resolved)`
hook — it returns live `{ item, active, disabled, run }` buttons and you own
every pixel of markup. You never lose the registry — only the markup changes.
