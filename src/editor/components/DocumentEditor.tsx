import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import type { EditorApi } from '../core/EditorApi'
import { EditorContextMenu } from './EditorContextMenu'
import { EditorToolbar } from './EditorToolbar'
import { InsertToolbar } from './InsertToolbar'
import { PageAffordances } from './PageAffordances'
import type { ResolvedFeatures } from '../core/registry'
import { useDocumentEditor, type UseDocumentEditorOptions } from '../hooks/useDocumentEditor'

export interface DocumentEditorRenderContext {
  editor: Editor | null
  api: EditorApi
  resolved: ResolvedFeatures
}

export interface DocumentEditorProps extends UseDocumentEditorOptions {
  /** Replace the whole toolbar with your own (Level 4). Defaults to
   *  {@link EditorToolbar}. */
  renderToolbar?: (ctx: DocumentEditorRenderContext) => ReactNode
  /** Replace the left insert rail. Defaults to {@link InsertToolbar}, which is
   *  shown automatically whenever an opted-in feature contributes inserts. */
  renderInsertBar?: (ctx: DocumentEditorRenderContext) => ReactNode
  /** Vertical rail to the right of the page (e.g. zoom / view controls). */
  renderRightBar?: (ctx: DocumentEditorRenderContext) => ReactNode
  /** Visual scale of the page (1 = 100%). */
  zoom?: number
}

/**
 * Drop-in editor: resolves the opt-in features, renders the toolbar, optional
 * left/right rails and the editable surface. Bars are swappable; the app never
 * touches `@tiptap/*` itself.
 */
export function DocumentEditor({
  renderToolbar,
  renderInsertBar,
  renderRightBar,
  zoom = 1,
  ...options
}: DocumentEditorProps) {
  const { editor, api, resolved } = useDocumentEditor(options)
  const ctx = api ? { editor, api, resolved } : null

  const toolbar = ctx
    ? renderToolbar
      ? renderToolbar(ctx)
      : <EditorToolbar editor={ctx.editor} api={ctx.api} resolved={ctx.resolved} />
    : null

  const insertBar = ctx
    ? renderInsertBar
      ? renderInsertBar(ctx)
      : resolved.inserts.length > 0
        ? <InsertToolbar editor={ctx.editor} api={ctx.api} resolved={ctx.resolved} />
        : null
    : null

  const rightBar = ctx && renderRightBar ? renderRightBar(ctx) : null

  return (
    <div className="document-editor">
      {insertBar ? <aside className="document-editor__rail">{insertBar}</aside> : null}
      <div className="document-editor__column">
        {toolbar}
        {/* The page scrolls inside its column when zoomed — the rails stay put. */}
        <div className="document-editor__zoom">
          <div className="document-editor__scale" style={{ zoom }}>
            {ctx && resolved.pageRegions.length > 0 ? (
              <PageAffordances api={ctx.api} regions={resolved.pageRegions} position="top" />
            ) : null}
            <EditorContent editor={editor} className="document-editor__surface" />
            {ctx && resolved.pageRegions.length > 0 ? (
              <PageAffordances api={ctx.api} regions={resolved.pageRegions} position="bottom" />
            ) : null}
          </div>
        </div>
      </div>
      {rightBar ? (
        <aside className="document-editor__rail document-editor__rail--right">{rightBar}</aside>
      ) : null}
      {ctx && resolved.contextMenu.length > 0 ? (
        <EditorContextMenu editor={ctx.editor} api={ctx.api} sections={resolved.contextMenu} />
      ) : null}
    </div>
  )
}
