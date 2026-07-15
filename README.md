# document-editor

A Google-Docs-style rich text editor built on **TipTap v3** (ProseMirror), with an opt-in **feature SDK**: each capability is a self-contained feature that a product enables by adding it to a list. The editor UI (bubble menu, insert dock, context menu) is rendered from the enabled features — never hardcoded.

## Highlights

- **Opt-in features** — `defineFeature()` bundles a TipTap extension with its commands, keybindings and bubble/insert contributions. Compose a product by listing the features it needs.
- **Engine kept behind a seam** — app code talks to a small `EditorApi` facade and never imports `@tiptap/*` (enforced by a test). `createMockEditor()` lets you test bars/commands with no real editor.
- **Headless + skinnable UI** — `useBubbleBar`/`useInsertBar` expose the live buttons; `BubbleBar`, `BubbleToolbar` and `InsertToolbar` are thin, overridable skins over them (chrome widgets are Material UI 7, themed via the `muiTheme` prop — see THEMING.md). `useZoom` ships the zoom state/policy for the `zoom` prop.
- **Portable content** — documents persist as a thin ProseMirror-JSON envelope (`DocumentJSON`, `{ doc }`). Loading content whose feature is disabled throws instead of silently wiping the document.
- **Built-in skin** — Emotion `<Global>` (`EditorSkin`, mounted by `DocumentEditor`; no .css files); theme via `--editor-*` tokens (see `THEMING.md`).

## Project layout

```
src/
├── editor/            # the SDK
│   ├── core/          # headless: defineFeature, registry, EditorApi, createEditor, createMockEditor, document
│   ├── hooks/         # useDocumentEditor, useFeatureState, useBar, createSuggestionPopup
│   ├── components/    # DocumentEditor, bars (bubble/insert; BubbleBar is the bubble's content engine), SlashMenu, EditorContextMenu, PageAffordances
│   ├── authoring.ts   # convenience TipTap re-exports for feature authors
│   ├── skin.tsx       # default skin: Emotion Global aggregating *.styles.ts partials (see THEMING.md)
│   └── index.ts       # public barrel
├── features/          # marks/ · blocks/ · custom/ · history
├── app/               # demo playground
└── stories/           # Storybook customization catalog (one story per seam)
```

Docs: `EXTENDING.md` (consumers) · `THEMING.md` (skin/tokens) ·
`ARCHITECTURE.md` (how the SDK works inside — for maintainers and feature authors).

## Getting started

```bash
pnpm install
pnpm dev          # run the playground
pnpm storybook    # the customization catalog (one story per seam)
pnpm test         # Vitest + Testing Library
pnpm typecheck    # tsc --noEmit
pnpm build        # production build
```

## Stack

React 19 · TypeScript 6 · Vite 8 · Vitest 4 · TipTap v3.
