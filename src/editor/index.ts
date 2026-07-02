// Feature contract
export { defineFeature } from './core/defineFeature'
export type {
  CommandFn,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSection,
  FeatureDefinition,
  FeatureRenderContext,
  PageRegion,
  PanelContribution,
  ToolbarItem,
} from './core/types'

// Composition
export { resolveFeatures } from './core/registry'
export type { ResolvedFeatures } from './core/registry'
export { kernelExtensions, buildExtensions } from './core/buildExtensions'

// Editor construction
export { createEditor } from './core/createEditor'
export type { CreateEditorOptions, CreatedEditor } from './core/createEditor'
export { useDocumentEditor } from './hooks/useDocumentEditor'
export type { UseDocumentEditorOptions, DocumentEditorHandle } from './hooks/useDocumentEditor'

// App-facing surface
export { createEditorApi } from './core/EditorApi'
export type { EditorApi, EditorStateView } from './core/EditorApi'
export { createMockEditor } from './core/createMockEditor'
export type { MockEditor, MockEditorInit } from './core/createMockEditor'
export { useFeatureState } from './hooks/useFeatureState'
export { useToolbar, useInsertBar, useToolbarButtons } from './hooks/useToolbar'
export type { ToolbarButton } from './hooks/useToolbar'
export { createSuggestionPopup, useListKeyboardNav } from './hooks/createSuggestionPopup'
export type { SuggestionPopupRef } from './hooks/createSuggestionPopup'
export { useDismissable } from './hooks/useDismissable'
export { EditorToolbar } from './components/EditorToolbar'
export type { EditorToolbarProps } from './components/EditorToolbar'
export { BubbleToolbar } from './components/BubbleToolbar'
export type { BubbleToolbarProps } from './components/BubbleToolbar'
export { InsertToolbar } from './components/InsertToolbar'
export type { InsertToolbarProps } from './components/InsertToolbar'
export { EditorContextMenu, ContextMenuView } from './components/EditorContextMenu'
export { PageAffordances } from './components/PageAffordances'
export { FeaturePanels } from './components/FeaturePanels'
export { DocumentEditor } from './components/DocumentEditor'
export type { DocumentEditorProps, DocumentEditorRenderContext } from './components/DocumentEditor'
export { EditorContent } from '@tiptap/react'

// Content / persistence
export { createEmptyDocument, toDocumentJSON, exportHTML } from './core/document'
export type { DocumentJSON } from './core/document'

// Authoring surface for custom features
export * from './authoring'
