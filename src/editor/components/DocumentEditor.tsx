import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import type { Theme } from '@mui/material/styles'
import type { EditorApi } from '../core/EditorApi'
import { BubbleToolbar } from './BubbleToolbar'
import { EditorContextMenu } from './EditorContextMenu'
import { InsertToolbar } from './InsertToolbar'
import { PageAffordances } from './PageAffordances'
import { useFeatureState } from '../hooks/useFeatureState'
import type { ResolvedFeatures } from '../core/registry'
import { useDocumentEditor, type UseDocumentEditorOptions } from '../hooks/useDocumentEditor'
import { EditorSkin } from '../skin'
import { EditorThemeProvider } from '../theme'

export interface DocumentEditorRenderContext {
  /** Never null: the context is only built once the editor exists — render
   *  props can use it directly, no guards. */
  editor: Editor
  api: EditorApi
  resolved: ResolvedFeatures
}

export interface DocumentEditorProps extends UseDocumentEditorOptions {
  /** Replace the bubble surface with your own. There is no static
   *  top bar: the default is {@link BubbleToolbar} — a floating formatting
   *  bar over the text selection. */
  renderBubble?: (ctx: DocumentEditorRenderContext) => ReactNode
  /** Content for the editor HEADER — a fixed-height sticky bar the SDK ships
   *  by default (fill it with your title/actions; the shell's height and look
   *  come from the skin: `--editor-header-height`). Return `null` (or any
   *  nothing-to-render value: `undefined`/booleans, e.g. from `cond && <Bar/>`)
   *  to hide the header entirely. Omit for the default (an empty bar). */
  renderHeader?: (ctx: DocumentEditorRenderContext) => ReactNode
  /** Content for the editor FOOTER — the fixed rounded bar over the page
   *  bottom. Defaults to the insert ACTIONS ({@link InsertToolbar}); pass your
   *  own composition to keep the shell and swap the content. Return `null`
   *  (or `undefined`/booleans — anything React renders as nothing) to hide
   *  the footer entirely (e.g. read-only mode) — the page's bottom clearance
   *  goes with it. */
  renderFooter?: (ctx: DocumentEditorRenderContext) => ReactNode
  /** CONSUMER-owned side panel in the LEFT gutter: render anything —
   *  including the insert actions themselves (`<InsertToolbar {...ctx}
   *  className="…"/>` is headless; pair it with `renderFooter={() => null}`
   *  to drop the footer). Omit for no panel. */
  renderLeftPanel?: (ctx: DocumentEditorRenderContext) => ReactNode
  /** CONSUMER-owned side panel in the RIGHT gutter (zoom controls, the
   *  review-comments panel via `<CommentsPanel editor={ctx.editor}/>`, or any
   *  UI of yours). Omit for no panel. */
  renderRightPanel?: (ctx: DocumentEditorRenderContext) => ReactNode
  /** Shown centered on the SCREEN while the document is empty; disappears as
   *  soon as there is content. The overlay never steals clicks from the editor
   *  (`pointer-events: none`; its children are clickable again). It spans the
   *  viewport (`position: fixed`) — intended for a full-page editor; embedded
   *  layouts should restyle `.document-editor__empty-state` (see THEMING.md). */
  renderEmptyState?: (ctx: DocumentEditorRenderContext) => ReactNode
  /** Visual scale of the page (1 = 100%). */
  zoom?: number
  /** MUI theme for the editor CHROME (menus, popovers, buttons, forms).
   *  Defaults to `createEditorTheme()` — the product look, with every visible
   *  knob reading the `--editor-*` tokens. Pass `createEditorTheme(overrides)`
   *  (or your app's theme) for full-fidelity chrome theming; the tokens keep
   *  owning the document CONTENT skin either way. */
  muiTheme?: Theme
}

/** Screen-centered overlay, visible only while the document is BLANK. Reads
 *  the facade's `isEmpty` (the blank-document check), not TipTap's — inserting
 *  a table with no text yet must dismiss it. */
function EmptyStateOverlay({
  ctx,
  render,
}: {
  ctx: DocumentEditorRenderContext
  render: (ctx: DocumentEditorRenderContext) => ReactNode
}) {
  const isEmpty = useFeatureState(ctx.editor, () => ctx.api.isEmpty()) ?? false
  if (!isEmpty) return null
  return <div className="document-editor__empty-state">{render(ctx)}</div>
}

/**
 * Drop-in editor: resolves the opt-in features and renders the chrome —
 * header and footer bars (both default-on, both hideable), the bubble
 * toolbar, consumer side panels — around the editable surface. Every surface
 * is swappable; the app never touches `@tiptap/*` itself.
 */
export function DocumentEditor({
  renderBubble,
  renderHeader,
  renderFooter,
  renderLeftPanel,
  renderRightPanel,
  renderEmptyState,
  zoom = 1,
  muiTheme,
  ...options
}: DocumentEditorProps) {
  const { editor, api, resolved } = useDocumentEditor(options)
  const ctx = editor && api ? { editor, api, resolved } : null
  // Read-only hides the SDK chrome that mutates content (default insert
  // actions, page-region affordances, context menu). A consumer-supplied
  // renderFooter owns its own gating — it gets the same `editable` knowledge.
  const editable = options.editable ?? true

  const bubble = ctx
    ? renderBubble
      ? renderBubble(ctx)
      : <BubbleToolbar editor={ctx.editor} api={ctx.api} resolved={ctx.resolved} />
    : null

  // Header/footer semantics: the SHELLS are the SDK's (fixed heights, skin);
  // the render props fill them. Omitted → defaults (empty header, the insert
  // actions in the footer); returning any nothing-to-render value (null,
  // undefined, a boolean — the `cond && <Bar/>` idiom) hides the bar entirely,
  // never an empty floating shell.
  const hidesShell = (value: ReactNode) => value == null || typeof value === 'boolean'
  const header = ctx
    ? renderHeader
      ? renderHeader(ctx)
      : <></> /* default: an empty bar — the shell itself is the product */
    : null

  const footer = ctx
    ? renderFooter
      ? renderFooter(ctx)
      : resolved.inserts.length > 0 && editable
        ? <InsertToolbar editor={ctx.editor} api={ctx.api} resolved={ctx.resolved} />
        : null
    : null

  const leftPanel = ctx && renderLeftPanel ? renderLeftPanel(ctx) : null
  const rightPanel = ctx && renderRightPanel ? renderRightPanel(ctx) : null

  return (
    // ONE provider covers every surface: context crosses createPortal AND
    // TipTap's ReactRenderer, so body-portaled menus/popovers inherit it.
    <EditorThemeProvider theme={muiTheme}>
      <div className="document-editor">
        {/* The skin travels with the component now (Emotion Global) — there is
            no editor.css to import. Duplicate mounts are harmless. */}
        <EditorSkin />
        {!hidesShell(header) ? <header className="document-editor__header">{header}</header> : null}
        {/* Fixed over the page bottom (out of flow) — the document scrolls
            behind it and the shell reserves clearance below the page. */}
        {!hidesShell(footer) ? <div className="document-editor__footer">{footer}</div> : null}
        {leftPanel ? (
          <aside className="document-editor__panel document-editor__panel--left">{leftPanel}</aside>
        ) : null}
        <div className="document-editor__column">
          {bubble}
          {/* The page scrolls inside its column when zoomed — the rails stay put. */}
          <div
            className={`document-editor__zoom${zoom > 1 ? ' document-editor__zoom--scrolls' : ''}`}
          >
            <div className="document-editor__scale" style={{ zoom }}>
              {ctx && editable && resolved.pageRegions.length > 0 ? (
                <PageAffordances api={ctx.api} regions={resolved.pageRegions} position="top" />
              ) : null}
              <EditorContent editor={editor} className="document-editor__surface" />
              {ctx && editable && resolved.pageRegions.length > 0 ? (
                <PageAffordances api={ctx.api} regions={resolved.pageRegions} position="bottom" />
              ) : null}
            </div>
          </div>
        </div>
        {rightPanel ? (
          <aside className="document-editor__panel document-editor__panel--right">{rightPanel}</aside>
        ) : null}
        {ctx && renderEmptyState ? <EmptyStateOverlay ctx={ctx} render={renderEmptyState} /> : null}
        {ctx && editable && resolved.contextMenu.length > 0 ? (
          <EditorContextMenu editor={ctx.editor} api={ctx.api} sections={resolved.contextMenu} />
        ) : null}
      </div>
    </EditorThemeProvider>
  )
}
