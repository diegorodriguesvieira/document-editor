import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import {
  BubbleToolbar,
  DocumentEditor,
  InsertToolbar,
  useFeatureState,
  useZoom,
  type DocumentEditorRenderContext,
  type DocumentJSON,
  type EditorApi,
} from '../editor'
import {
  AnchorFlushBinder,
  CommentsLayer,
  CommentsPanel,
  CommentsProvider,
  DocumentVariablesProvider,
  type ConditionFlag,
  type DocumentVariable,
} from '../features'
import { contractTemplate } from './contractTemplate'
import { createFakeCommentsApi, MOCK_USER } from './commentsMock'
import { normalizeConditionals, RAW_CONDITIONALS } from './decisionConditionals'
import { ZoomControls } from './ZoomControls'
import { fullFeatures } from './presets'
import './styles.css' // demo-app chrome (the SDK skin now ships inside the components)

/**
 * Preview/edit toggle — hidden while the document is BLANK: there is nothing
 * to preview, and the empty-state overlay owns that moment. It stays visible
 * in preview itself (a programmatically emptied doc must not trap the mode).
 * Live via the SDK's blessed header recipe: useFeatureState + api.isEmpty.
 */
function ModeToggle({
  ctx,
  preview,
  onToggle,
}: {
  ctx: DocumentEditorRenderContext
  preview: boolean
  onToggle: () => void
}) {
  const isEmpty = useFeatureState(ctx.editor, () => ctx.api.isEmpty()) ?? true
  if (isEmpty && !preview) return null
  return (
    <Button
      className="app__mode"
      size="small"
      variant="outlined"
      aria-pressed={preview}
      onClick={onToggle}
    >
      {preview ? 'Edit' : 'Preview'}
    </Button>
  )
}

// Fake comments backend (module-scope: one "database" per app load) — a real
// consumer builds a CommentsAdapter over its HTTP client instead.
const commentsApi = createFakeCommentsApi()

export default function App() {
  // Zoom state + policy (clamp/step/rounding) come ready from the SDK hook;
  // the buttons below are the app's own UI on top of it.
  const { zoom, zoomIn, zoomOut, canZoomIn, canZoomOut } = useZoom()

  // Preview (read-only) vs edit. The SDK reacts to the `editable` prop live —
  // no remount, so undo history and scroll survive the toggle. The app only
  // hides its OWN mutating chrome (the insert actions); the SDK hides the rest.
  const [preview, setPreview] = useState(false)

  // The comments doc-first pump reads flushAnchors through this ref (bound by
  // AnchorFlushBinder inside the provider).
  const flushAnchorsRef = useRef<(() => Promise<void>) | null>(null)
  const bindFlushAnchors = useCallback((flush: (() => Promise<void>) | null) => {
    flushAnchorsRef.current = flush
  }, [])

  // ONE save pump for both entry points: organic edits (onChange hands the
  // serialized doc) and provider-requested cycles (a queued create, an anchor
  // Retry — no doc change happened, so the doc is read off the live api).
  const editorApiRef = useRef<EditorApi | null>(null)
  const pumpSave = useCallback((doc?: DocumentJSON) => {
    const json = doc ?? editorApiRef.current?.getJSON()
    if (!json) return
    void commentsApi
      .saveTemplate(json)
      .then(() => flushAnchorsRef.current?.())
      .catch((failure) => {
        // Doc save failed → anchors are NOT touched; the queue waits for the
        // next successful save.
        console.warn('[autosave] document save failed', failure)
      })
  }, [])

  // Fake API: @-variables and the EOR decision catalog arrive ~1.5s after
  // mount. Because they flow through context (not the `features` list), the
  // editor mounts immediately and does NOT remount when they arrive — only
  // the pickers fill in. Decisions go through the `conditions` prop: the
  // provider scopes them to the conditional-block builder (never the @ menu).
  const [docVariables, setDocVariables] = useState<DocumentVariable[]>([])
  const [decisionFlags, setDecisionFlags] = useState<ConditionFlag[]>([])
  useEffect(() => {
    const timer = setTimeout(() => {
      setDocVariables([
        { id: 'client.name', label: 'Client name', group: 'Client details' },
        { id: 'client.taxId', label: 'Tax ID', group: 'Client details' },
        { id: 'contract.number', label: 'Contract number', group: 'Contract details' },
        { id: 'contract.term', label: 'Term', group: 'Contract details' },
        { id: 'amount.monthly', label: 'Monthly amount', group: 'Contract details' },
        { id: 'client.signature', label: 'Client signature', group: 'Signatures', type: 'signature' },
        { id: 'company.signature', label: 'Company signature', group: 'Signatures', type: 'signature' },
      ])
      setDecisionFlags(normalizeConditionals(RAW_CONDITIONALS))
    }, 1500)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="app">
      <main className="app__canvas">
        {/* Document variables come from here (consumer), via context — shared by
            variables and conditional blocks. `conditions` = the backend decision
            catalog, offered only in the conditional-block builder. */}
        <DocumentVariablesProvider variables={docVariables} conditions={decisionFlags}>
          {/* Review comments: identity + endpoints come from the consumer.
              Context reaches every surface, including the body-portaled
              balloon and the right-rail panel. */}
          <CommentsProvider user={MOCK_USER} adapter={commentsApi.adapter} onFlushNeeded={pumpSave}>
          <AnchorFlushBinder bind={bindFlushAnchors} />
          {/* The full feature set, presented through the bubble + footer dock. */}
          <DocumentEditor
            features={fullFeatures}
            zoom={zoom}
            editable={!preview}
            // The editor's own HEADER bar (fixed height, SDK shell) — the app
            // only brings its content, including the preview/edit toggle.
            renderHeader={(ctx) => (
              <>
                <span className="app__title">Untitled document</span>
                <span className="app__hint">
                  @ variables: {docVariables.length ? `${docVariables.length} loaded` : 'loading…'}
                </span>
                <ModeToggle
                  ctx={ctx}
                  preview={preview}
                  onToggle={() => setPreview((current) => !current)}
                />
              </>
            )}
            // `onChange` is debounced (~250ms after edits stop) — the autosave
            // moment, and the DOC-FIRST pump (plan §7): PUT the document, and
            // only after that save RESOLVES flush the queued comment-anchor
            // writes. That call order is the whole doc-first guarantee — no
            // anchor write ever describes an unsaved document.
            onChange={(doc) => pumpSave(doc)}
            onReady={(api) => {
              editorApiRef.current = api
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
                <Button
                  variant="contained"
                  className="empty-state__cta"
                  onClick={() => ctx.api.setJSON(contractTemplate(ctx.editor))}
                >
                  Start from a template
                </Button>
              </div>
            )}
            // The right rail is consumer-owned. The comments panel lives in
            // BOTH modes (highlights are decorations; it self-hides while
            // empty) — only COMPOSING a comment is preview-only.
            renderRightPanel={(ctx) => (
              <div className="right-rail">
                <CommentsPanel editor={ctx.editor} />
              </div>
            )}
            // FOOTER content (the fixed shell is the SDK's): zoom on the
            // left, the insert actions centered (headless InsertToolbar) and
            // the Send action on the right.
            renderFooter={(ctx) => (
              <div className="app-dock">
                <ZoomControls
                  zoom={zoom}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  canZoomIn={canZoomIn}
                  canZoomOut={canZoomOut}
                />
                {!preview && <InsertToolbar {...ctx} className="app-dock__items" />}
                <Button
                  variant="contained"
                  className="app-dock__send"
                  onClick={() => console.log('send → would submit', ctx.api.getJSON())}
                >
                  Send
                </Button>
              </div>
            )}
            // The bubble is the ONLY toolbar (plus the footer insert dock).
            // Undo/redo stay out: not selection-scoped (keyboard covers them).
            // CommentsLayer rides along in both modes: the doc↔backend
            // reconciliation bridge, plus the "Add comment" balloon —
            // preview-only (the bubble is edit-only), so the two floating
            // surfaces never coexist.
            renderBubble={(ctx) => (
              <>
                <BubbleToolbar {...ctx} filter={(item) => item.group !== 'history'} />
                <CommentsLayer editor={ctx.editor} />
              </>
            )}
          />
          </CommentsProvider>
        </DocumentVariablesProvider>
      </main>
    </div>
  )
}
