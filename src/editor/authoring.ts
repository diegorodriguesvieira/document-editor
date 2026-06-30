/**
 * Curated authoring surface for feature packages. Custom features import their
 * building blocks from here (the SDK) rather than reaching into `@tiptap/*`
 * directly — so the engine stays an implementation detail of the SDK.
 */
export { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
export type { AnyExtension, ChainedCommands, CommandProps } from '@tiptap/core'
export {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from '@tiptap/react'
export type { NodeViewProps } from '@tiptap/react'
