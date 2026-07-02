/**
 * Convenience authoring surface for feature packages: re-exports of the TipTap
 * building blocks most features need, so simple features get by with a single
 * import. Features are TipTap-native BY DESIGN (the two-level boundary insulates
 * `src/app`, not features) — importing `@tiptap/*` directly for anything not
 * re-exported here (ProseMirror plugins, model types, …) is normal and fine.
 */
export { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
export type { AnyExtension, ChainedCommands, CommandProps, Editor } from '@tiptap/core'
export {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from '@tiptap/react'
export type { NodeViewProps } from '@tiptap/react'
