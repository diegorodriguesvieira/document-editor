# document-editor

A Google-Docs-style rich text editor built on **TipTap v3** (ProseMirror), with an opt-in **feature SDK**: each capability is a self-contained feature that a product enables by adding it to a list. The editor UI (toolbars, bubble menu, insert rail) is rendered from the enabled features — never hardcoded.

## Highlights

- **Opt-in features** — `defineFeature()` bundles a TipTap extension with its commands, keybindings and toolbar/insert contributions. Compose a product by listing the features it needs.
- **Engine kept behind a seam** — app code talks to a small `EditorApi` facade and never imports `@tiptap/*` (enforced by a test). `createMockEditor()` lets you test toolbars/commands with no real editor.
- **Headless + skinnable UI** — `useToolbar`/`useInsertBar` expose the live buttons; `EditorToolbar`, `BubbleToolbar` and `InsertToolbar` are thin, overridable skins over them.
- **Portable content** — documents persist as a thin ProseMirror-JSON envelope (`DocumentJSON`, `{ doc }`). Loading content whose feature is disabled throws instead of silently wiping the document.
- **Optional skin** — one `editor.css` import; theme via `--editor-*` tokens, override anything without `!important` thanks to `@layer` (see `THEMING.md`).

## Project layout

```
src/
├── editor/            # the SDK
│   ├── core/          # headless: defineFeature, registry, EditorApi, createEditor, createMockEditor, document
│   ├── hooks/         # useDocumentEditor, useFeatureState, useToolbar, createSuggestionPopup
│   ├── components/    # DocumentEditor, toolbars (top/bubble/insert), SlashMenu, EditorContextMenu, PageAffordances
│   ├── authoring.ts   # convenience TipTap re-exports for feature authors
│   ├── editor.css     # optional default skin (tokens + @layer, see THEMING.md)
│   └── index.ts       # public barrel
├── features/          # marks/ · blocks/ · custom/ · history
└── app/               # demo playground
```

## Getting started

```bash
pnpm install
pnpm dev          # run the playground
pnpm test         # Vitest + Testing Library
pnpm typecheck    # tsc --noEmit
pnpm build        # production build
```

## Stack

React 19 · TypeScript 6 · Vite 8 · Vitest 4 · TipTap v3.
