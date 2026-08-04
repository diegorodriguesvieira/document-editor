// The public surface — exactly what the docs teach, nothing "just in case".
// Internals (buildExtensions, createEditorApi, ContextMenuView, …) stay module
// exports for the SDK's own files and tests; add one here only when a doc
// section sells it.

// Feature contract
export { defineFeature } from './core/defineFeature'
export type {
  BubbleItem,
  CommandFn,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuRenderContext,
  ContextMenuSection,
  FeatureDefinition,
  FeatureRenderContext,
  InsertItem,
  NodeBubbleSection,
  PageRegion,
} from './core/types'

// Composition
export { resolveFeatures } from './core/registry'
export type { ResolvedFeatures } from './core/registry'

// Editor construction
export { createEditor } from './core/createEditor'
export type { CreateEditorOptions, CreatedEditor } from './core/createEditor'
export { useDocumentEditor } from './hooks/useDocumentEditor'
export type { UseDocumentEditorOptions, DocumentEditorHandle } from './hooks/useDocumentEditor'

// App-facing surface
export type { EditorApi, EditorStateView, FoundNode } from './core/EditorApi'
export { createMockEditor } from './core/createMockEditor'
export type { MockActiveEntry, MockEditor, MockEditorInit } from './core/createMockEditor'
export { useFeatureState } from './hooks/useFeatureState'
export { useBubbleBar, useInsertBar, useNodeBubbleBar } from './hooks/useBar'
export type { BarButton } from './hooks/useBar'
export { createSuggestionPopup, useListKeyboardNav } from './hooks/createSuggestionPopup'
export type { SuggestionPopupRef } from './hooks/createSuggestionPopup'
export { useDismissable, useEscapeSurface } from './hooks/useDismissable'
export { PopupShell } from './components/PopupShell'
export { POPUP_CLASS } from './base.styles'
export { SuggestionList } from './components/SuggestionList'
export { useZoom } from './hooks/useZoom'
export { createEditorTheme, EditorThemeProvider, tokenVar } from './theme'
export type { UseZoomOptions } from './hooks/useZoom'
export { BubbleBar } from './components/BubbleBar'
export type { BubbleBarProps } from './components/BubbleBar'
export { BubbleToolbar } from './components/BubbleToolbar'
export type { BubbleToolbarProps } from './components/BubbleToolbar'
export { NodeBubbleToolbar } from './components/NodeBubbleToolbar'
export type { NodeBubbleToolbarProps } from './components/NodeBubbleToolbar'
export { InsertToolbar } from './components/InsertToolbar'
export type { InsertToolbarProps } from './components/InsertToolbar'
export { EditorContextMenu } from './components/EditorContextMenu'
export type { EditorContextMenuProps } from './components/EditorContextMenu'
export { PageAffordances } from './components/PageAffordances'
export type { PageAffordancesProps } from './components/PageAffordances'
export { DocumentEditor } from './components/DocumentEditor'
export type { DocumentEditorProps, DocumentEditorRenderContext } from './components/DocumentEditor'
// The Emotion skin (successor of the editor.css import). DocumentEditor mounts
// one automatically; custom shells render it once themselves.
export { EditorSkin } from './skin'
export { EditorContent } from '@tiptap/react'

// Content / persistence
export type { DocumentJSON } from './core/document'
export { hasTopLevelNode } from './core/document'
export { injectNodeIds, stripNodeIds } from './core/nodeIds'

// Authoring surface for custom features
export * from './authoring'
