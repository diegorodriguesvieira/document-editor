import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import {
  BubbleToolbar,
  DocumentEditor,
  DocumentSaveProvider,
  InsertToolbar,
  useDocumentSave,
  useFeatureState,
  useZoom,
  type DocumentEditorRenderContext,
} from '../editor'
import {
  CommentsLayer,
  CommentsPanel,
  CommentsProvider,
  DocumentVariablesProvider,
  type ConditionFlag,
  type DocumentVariable,
} from '../features'
import { contractTemplate } from './contractTemplate'
import {
  createFakeCommentsApi,
  isVersionConflict,
  MOCK_USER,
  type SaveEnvelope,
} from './commentsMock'
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
// consumer builds a CommentsAdapter over its HTTP client instead. Exported so
// the demo (and its tests) can drive the backend from outside: inject a
// failure, or save from "another session" to provoke a version conflict.
export const commentsApi = createFakeCommentsApi()

/**
 * The two save notices, one slot — driven straight by the SDK's save state.
 * A stale version is not something the user can retry into submission (another
 * session owns the document now), so the reload notice wins over — and
 * outlives — the retry one.
 */
function SaveBanner() {
  const state = useDocumentSave()?.state ?? 'saved'
  // Dismissible on purpose: the autosave keeps no timer of its own, the next
  // edit IS the retry — there is nothing here for the user to do. A LATER
  // failure raises it again (every cycle passes through `saving` first, so
  // this effect re-runs).
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (state === 'failed') setDismissed(false)
  }, [state])

  if (state === 'stopped') {
    return (
      <div className="app__banner app__banner--conflict" role="alert">
        <span>
          This document was saved in another session. Reload to continue from the latest
          version — changes made here since then are not saved.
        </span>
        <Button size="small" variant="outlined" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    )
  }
  if (state === 'failed' && !dismissed) {
    return (
      <div className="app__banner app__banner--failed" role="status">
        <span>Changes are not saved — your next edit retries the whole save.</span>
        <Button size="small" variant="outlined" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    )
  }
  return null
}

export default function App() {
  // Zoom state + policy (clamp/step/rounding) come ready from the SDK hook;
  // the buttons below are the app's own UI on top of it.
  const { zoom, zoomIn, zoomOut, canZoomIn, canZoomOut } = useZoom()

  // Preview (read-only) vs edit. The SDK reacts to the `editable` prop live —
  // no remount, so undo history and scroll survive the toggle. The app only
  // hides its OWN mutating chrome (the insert actions); the SDK hides the rest.
  const [preview, setPreview] = useState(false)

  // THE SAVE CADENCE is the consumer's policy, NOT the SDK's: a network write
  // should not fire on every typing pause. Every edit burst funnels through
  // this window, so a paragraph of typing costs ONE envelope. Everything else
  // about the cycle — one envelope in flight, coalescing, stopping for good,
  // the flush on teardown and on leaving edit mode — is the SDK's.
  const AUTOSAVE_MS = 1500

  // The version this session is editing on top of — the optimistic-concurrency
  // token. A real consumer gets it with the document it loaded; here the mock
  // hands out its current one at mount. Every ACCEPTED save returns the version
  // it produced, and that becomes the token for the next one. Reading
  // `commentsApi.versionId` at send time instead would defeat the whole
  // mechanism: the client would always look up to date and could silently
  // overwrite a save that landed in between.
  //
  // It lives HERE, in the save closure, because it is the backend's contract,
  // not the editor's: the SDK carries the envelope without ever reading it.
  const versionRef = useRef(commentsApi.versionId)
  const save = useCallback(async (envelope: Omit<SaveEnvelope, 'versionId'>) => {
    try {
      const result = await commentsApi.saveEnvelope({
        versionId: versionRef.current,
        ...envelope,
      })
      versionRef.current = result.versionId
      return result
    } catch (failure) {
      console.warn('[autosave] envelope save failed', failure)
      throw failure // `shouldStop` below decides whether saving gives up
    }
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
    // The save layer wraps everything: the envelope is the DOCUMENT's save
    // (comments only contributes its anchors and queued creates to it), and
    // the banner below reads its state from here.
    <DocumentSaveProvider save={save} debounceMs={AUTOSAVE_MS} shouldStop={isVersionConflict}>
    <div className="app">
      <SaveBanner />
      <main className="app__canvas">
        {/* Document variables come from here (consumer), via context — shared by
            variables and conditional blocks. `conditions` = the backend decision
            catalog, offered only in the conditional-block builder. */}
        <DocumentVariablesProvider variables={docVariables} conditions={decisionFlags}>
          {/* Review comments: identity + endpoints come from the consumer.
              Context reaches every surface, including the body-portaled
              balloon and the right-rail panel. */}
          <CommentsProvider user={MOCK_USER} adapter={commentsApi.adapter}>
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
            // No `onChange` here: the save layer above watches the editor
            // itself and snapshots doc + anchors + creates from one editor
            // state (the coherence law). `onChange` is for consumers that want
            // the serialized DOCUMENT — a mirror, a word count, their own pump.
            //
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
    </DocumentSaveProvider>
  )
}
