import { useEffect, useState } from 'react'
import { BubbleToolbar, DocumentEditor, InsertToolbar, useZoom } from '../editor'
import { DocumentVariablesProvider, type DocumentVariable } from '../features'
import { CommentCards } from './CommentCards'
import { contractTemplate } from './contractTemplate'
import { ZoomControls } from './ZoomControls'
import { fullFeatures } from './presets'
import './styles.css' // demo-app chrome (the SDK skin now ships inside the components)

export default function App() {
  // Zoom state + policy (clamp/step/rounding) come ready from the SDK hook;
  // the buttons below are the app's own UI on top of it.
  const { zoom, zoomIn, zoomOut, canZoomIn, canZoomOut } = useZoom()

  // Fake API: @-variables arrive ~1.5s after mount. Because they flow through
  // context (not the `features` list), the editor mounts immediately and does
  // NOT remount when they arrive — only the @ modal fills in.
  const [mergeVariables, setMergeVariables] = useState<DocumentVariable[]>([])
  useEffect(() => {
    const timer = setTimeout(() => {
      setMergeVariables([
        { id: 'cliente.nome', label: 'Client name', group: 'Client details' },
        { id: 'cliente.cnpj', label: 'Tax ID', group: 'Client details' },
        { id: 'contrato.numero', label: 'Contract number', group: 'Contract details' },
        { id: 'contrato.vigencia', label: 'Term', group: 'Contract details' },
        { id: 'valor.mensal', label: 'Monthly amount', group: 'Contract details' },
      ])
    }, 1500)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__title">Untitled document</span>
        <div className="app__controls">
          <span className="app__hint">
            @ variables: {mergeVariables.length ? `${mergeVariables.length} loaded` : 'loading…'}
          </span>
        </div>
      </header>

      <main className="app__canvas">
        {/* Document variables come from here (consumer), via context — shared by
            merge fields and conditional blocks. */}
        <DocumentVariablesProvider variables={mergeVariables}>
          {/* Same features, three different toolbar presentations — chosen by the app. */}
          <DocumentEditor
            features={fullFeatures}
            zoom={zoom}
            // `onChange` is debounced (~250ms after edits stop) — i.e. the exact
            // moment an autosave would fire. Here we just log the generated JSON.
            onChange={(doc) => {
              console.log(`[autosave ${new Date().toLocaleTimeString()}] would persist now`)
              console.log('document JSON:', doc)
            }}
            // Shown centered on screen while the doc is empty; the CTA inserts
            // a starter template (and the overlay vanishes — no longer empty).
            renderEmptyState={(ctx) => (
              <div className="empty-state">
                <span className="empty-state__icon" aria-hidden>
                  📄
                </span>
                <span className="empty-state__title">Blank document</span>
                <span className="empty-state__hint">
                  Start typing — <kbd>/</kbd> inserts blocks, <kbd>@</kbd> inserts variables
                </span>
                <button
                  type="button"
                  className="empty-state__cta"
                  onClick={() => ctx.api.setJSON(contractTemplate(ctx.editor))}
                >
                  Start from a template
                </button>
              </div>
            )}
            // The right rail is consumer-owned: render anything here. This app
            // ships its OWN comments UI (CommentCards, built on the SDK's
            // useDocumentComments hook) — swap back to the SDK's CommentsPanel
            // any time, same data, same click-to-scroll.
            renderRightBar={(ctx) => (
              <div className="right-rail">
                <CommentCards editor={ctx.editor} />
              </div>
            )}
            // The footer dock is APP-composed (Level 4): zoom on the left, the
            // SDK's insert items centered (headless InsertToolbar) and the Send
            // action on the right. Replacing the SDK dock means the app owns
            // its bottom clearance too (see .app__canvas).
            renderInsertBar={(ctx) => (
              <div className="app-dock">
                <ZoomControls
                  zoom={zoom}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  canZoomIn={canZoomIn}
                  canZoomOut={canZoomOut}
                />
                <InsertToolbar {...ctx} className="app-dock__items" />
                <button
                  type="button"
                  className="app-dock__send"
                  onClick={() => console.log('send → would submit', ctx.api.getJSON())}
                >
                  Send
                </button>
              </div>
            )}
            // The bubble is the ONLY toolbar (plus the footer insert dock).
            // Undo/redo stay out: not selection-scoped (keyboard covers them).
            renderToolbar={(ctx) => (
              <BubbleToolbar {...ctx} filter={(item) => item.group !== 'history'} />
            )}
          />
        </DocumentVariablesProvider>
      </main>
    </div>
  )
}
