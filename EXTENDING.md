# Extending the editor

The editor is an opt-in **feature SDK**. As a consuming team you mostly do two
things: **add a custom extension** and/or **add a toolbar / sidebar button**.
Both are a single `defineFeature` object passed to `<DocumentEditor features={[…]} />`.

**The one rule:** your app code imports from the SDK (`../editor`, `../features`),
**never `@tiptap/*`** directly — a test fails if the engine leaks into the app.
Features are the only place that touches TipTap.

---

## 1. Mount it

```tsx
import { DocumentEditor } from '../editor'
import { BoldFeature, ItalicFeature, HeadingFeature } from '../features'

<DocumentEditor features={[BoldFeature, ItalicFeature, HeadingFeature]} />
```

`features` is just an array — compose your own set (or spread an existing one and
add to it: `features={[...base, MyFeature]}`).

## 2. Add a custom extension + a button

A feature bundles a TipTap extension with the stable surface the app consumes:
its `commands` and where the buttons go. The node/mark building blocks come from
the SDK, never `@tiptap/*`.

```tsx
import { defineFeature, Node } from '../editor'

const Mention = Node.create({ name: 'mention', group: 'inline', inline: true /* … */ })

export const MentionFeature = defineFeature({
  id: 'mention',
  extensions: () => [Mention],
  commands: {
    'mention.insert': (editor) => editor.chain().focus().insertContent({ type: 'mention' }).run(),
  },
  // Left insert rail (also appears in the `/` menu automatically):
  insert: [{ id: 'mention', label: 'Mention', icon: '@', commandId: 'mention.insert' }],
  // …or the top formatting toolbar:
  // toolbar: [{ id: 'mention', label: 'Mention', commandId: 'mention.insert',
  //            isActive: (s) => s.isActive('mention') }],
})
```

Then add `MentionFeature` to the `features` array. No core changes.

## 3. A button without an extension

Just an action? Skip `extensions`:

```tsx
const Export = defineFeature({
  id: 'export',
  extensions: () => [],
  commands: { 'export.html': (editor) => (console.log(editor.getHTML()), true) },
  toolbar: [{ id: 'export', group: 'actions', label: 'Export', commandId: 'export.html' }],
})
```

A toolbar/insert item can also render fully custom UI via
`render: ({ api }) => <YourControl api={api} />` (see `AiAssistFeature`).

Item shape: `{ id, label, icon?, commandId?, group?, order?, isActive?, isDisabled?, render? }`
— `order` lets two features interleave their buttons deterministically;
`isActive`/`isDisabled` read the engine-agnostic state (`s.isActive('…')`,
`s.canUndo()`, …).

## 4. Save & load

```tsx
<DocumentEditor
  features={…}
  onChange={(doc) => save(doc)}   // debounced; `doc` is { doc: <ProseMirror JSON> }
  onReady={(api) => fetchDoc().then((d) => api.setJSON(d))}  // async load, no remount
/>
```

The persisted shape is `{ doc }` (ProseMirror JSON — portable, engine-detail-free).
The surface you'd use lives on `api`: `getJSON / setJSON / getHTML / exec(commandId)
/ isActive / canUndo / canRedo / on('update' | 'selection')`. Loading content with a
node whose feature is disabled throws (it won't silently wipe the document).

## 5. Runtime data (merge-field / conditional variables)

Variables come from **you** via context, not the `features` list — so loading them
async doesn't recreate the editor:

```tsx
import { DocumentVariablesProvider } from '../features'

<DocumentVariablesProvider variables={vars}>
  <DocumentEditor features={…} />
</DocumentVariablesProvider>
```

## Swapping the whole toolbar (optional)

`DocumentEditor` takes render props for full control while still driving off the
same registry data:

```tsx
<DocumentEditor
  features={…}
  renderToolbar={(ctx) => <EditorToolbar {...ctx} filter={(i) => i.group !== 'history'} />}
  renderInsertBar={(ctx) => <InsertToolbar {...ctx} />}
/>
```

Or build a totally custom bar on the headless `useToolbar(editor, api, resolved)`
hook (see `PillToolbar`). You never lose the registry — only the markup changes.
