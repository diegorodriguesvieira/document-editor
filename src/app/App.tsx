import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import {
  BubbleToolbar,
  DocumentEditor,
  InsertToolbar,
  useFeatureState,
  useZoom,
  type DocumentEditorRenderContext,
} from '../editor'
import {
  AnchorSyncBinder,
  CommentsLayer,
  CommentsPanel,
  CommentsProvider,
  DocumentVariablesProvider,
  type CommentAnchorSync,
  type ConditionFlag,
  type DocumentVariable,
} from '../features'
import { contractTemplate } from './contractTemplate'
import { createFakeCommentsApi, MOCK_USER, VERSION_CONFLICT } from './commentsMock'
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
 * Where the autosave stands, as the app shows it:
 * - `failed` — the envelope was rejected and NOTHING was persisted. Everything
 *   stays queued, so the next edit simply resends fresher state; the banner is
 *   dismissible because there is nothing for the user to DO about it.
 * - `conflict` — the envelope carried a stale `versionId`: someone else saved
 *   over this document. TERMINAL, because every retry would be rejected the
 *   same way; the app stops pumping and asks for a reload.
 */
type SaveStatus = 'saved' | 'failed' | 'conflict'

/** The backend's optimistic-concurrency rejection, in any of the shapes an
 *  adapter may hand it over in — the same duck-typing the SDK applies to its
 *  own coded rejections (`isStaleContentError`). */
const isVersionConflict = (failure: unknown): boolean => {
  if (typeof failure === 'string') return failure.includes(VERSION_CONFLICT)
  if (typeof failure !== 'object' || failure === null) return false
  const { code, message } = failure as { code?: unknown; message?: unknown }
  if (code === VERSION_CONFLICT) return true
  return typeof message === 'string' && message.includes(VERSION_CONFLICT)
}

export default function App() {
  // Zoom state + policy (clamp/step/rounding) come ready from the SDK hook;
  // the buttons below are the app's own UI on top of it.
  const { zoom, zoomIn, zoomOut, canZoomIn, canZoomOut } = useZoom()

  // Preview (read-only) vs edit. The SDK reacts to the `editable` prop live —
  // no remount, so undo history and scroll survive the toggle. The app only
  // hides its OWN mutating chrome (the insert actions); the SDK hides the rest.
  const [preview, setPreview] = useState(false)

  // The envelope pump reads the anchor sync through this ref (bound by
  // AnchorSyncBinder inside the provider).
  const anchorSyncRef = useRef<CommentAnchorSync | null>(null)
  const bindAnchorSync = useCallback((sync: CommentAnchorSync | null) => {
    anchorSyncRef.current = sync
  }, [])

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  // The retry banner is dismissible; a LATER failure raises it again.
  const [failureDismissed, setFailureDismissed] = useState(false)

  // The version this session is editing on top of — the optimistic-concurrency
  // token. A real consumer gets it with the document it loaded; here the mock
  // hands out its current one at mount. Every ACCEPTED save returns the version
  // it produced, and that becomes the token for the next one. Reading
  // `commentsApi.versionId` at send time instead would defeat the whole
  // mechanism: the client would always look up to date and could silently
  // overwrite a save that landed in between.
  const versionRef = useRef(commentsApi.versionId)
  // A conflict is terminal for this session (see SaveStatus) — the pump stops.
  const conflictRef = useRef(false)
  // One envelope in flight at a time, plus "an edit arrived while it flew".
  const savingRef = useRef(false)
  const againRef = useRef(false)

  // THE ENVELOPE PUMP (plan rodada 6): collect doc + dirty anchors + queued
  // creates from ONE editor state, PUT them as a single transaction, confirm
  // on success. On failure NOTHING persisted — discard and let the next
  // cycle resend fresher state.
  //
  // SERIALIZED on purpose: while one envelope flies, a second would carry the
  // SAME version token and be rejected as a conflict that never happened —
  // and its snapshot would be stale by the time it landed anyway. Overlapping
  // cycles coalesce into one follow-up, which collects fresher state than
  // either would have carried.
  const inFlightRef = useRef<Promise<void>>(Promise.resolve())
  const pumpSave = useCallback(function run(): Promise<void> {
    // Terminal, for BOTH entry points: the debounced onChange and the
    // provider's onFlushNeeded (a queued create asking for a cycle) come
    // through here, so after a conflict nothing can restart the loop.
    if (conflictRef.current) return inFlightRef.current
    if (savingRef.current) {
      againRef.current = true
      return inFlightRef.current
    }
    const sync = anchorSyncRef.current
    const payload = sync?.collectSavePayload()
    if (!sync || !payload) return Promise.resolve()
    savingRef.current = true
    const cycle = commentsApi
      .saveEnvelope({
        versionId: versionRef.current,
        doc: payload.doc,
        anchors: payload.anchors,
        creates: payload.creates,
      })
      .then((result) => {
        versionRef.current = result.versionId
        sync.confirmSaved(payload.token, result)
        setSaveStatus('saved')
      })
      .catch((failure) => {
        const conflict = isVersionConflict(failure)
        // A conflict is TERMINAL: the pump stops, so queued comments would
        // wait forever — settle them with the discard instead.
        sync.discardSave(payload.token, conflict ? { terminal: true } : undefined)
        if (conflict) {
          conflictRef.current = true
          setSaveStatus('conflict')
        } else {
          setSaveStatus('failed')
          setFailureDismissed(false)
        }
        console.warn('[autosave] envelope save failed', failure)
      })
      .finally(() => {
        savingRef.current = false
      })
      .then(() => {
        if (!againRef.current) return
        againRef.current = false
        return run()
      })
    inFlightRef.current = cycle
    return cycle
  }, [])


  // THE SAVE CADENCE is the consumer's policy, NOT the SDK's: `onChange` is
  // debounced for SERIALIZATION (250ms — getJSON is O(n)), which is far too
  // eager for a network write. Every edit burst funnels through this second,
  // longer window, so a paragraph of typing costs ONE envelope instead of one
  // per typing pause. Writes the user explicitly asked for (submitting a
  // comment, which arrives through the provider's onFlushNeeded) skip the
  // wait and pump immediately.
  const AUTOSAVE_MS = 1500
  const pumpTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scheduleSave = useCallback(() => {
    clearTimeout(pumpTimerRef.current)
    pumpTimerRef.current = setTimeout(() => {
      pumpTimerRef.current = undefined
      pumpSave()
    }, AUTOSAVE_MS)
  }, [pumpSave])
  /** Land whatever is pending NOW and resolve when it has: the provider
   *  awaits this before a review-mode create (its quote is validated against
   *  the SAVED document). */
  const flushSave = useCallback(() => {
    if (pumpTimerRef.current !== undefined) {
      clearTimeout(pumpTimerRef.current)
      pumpTimerRef.current = undefined
      return pumpSave()
    }
    return inFlightRef.current
  }, [pumpSave])
  // Nothing typed is lost on teardown: a pending window fires NOW.
  useEffect(
    () => () => {
      void flushSave()
    },
    [flushSave],
  )
  // Leaving EDIT mode is a natural save point — and a load-bearing one: a
  // review-mode comment is validated against the SAVED document, so the text
  // the reviewer is about to quote must already be on the server.
  useEffect(() => {
    if (preview) void flushSave()
  }, [preview, flushSave])

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
      {/* Two save banners, one slot. A stale version is not something the user
          can retry into submission — another session owns the document now, so
          the only way forward is to reload onto that version; it therefore
          wins over (and outlives) the retry notice. */}
      {saveStatus === 'conflict' ? (
        <div className="app__banner app__banner--conflict" role="alert">
          <span>
            This document was saved in another session. Reload to continue from the latest
            version — changes made here since then are not saved.
          </span>
          <Button size="small" variant="outlined" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      ) : saveStatus === 'failed' && !failureDismissed ? (
        // Dismissible on purpose: the autosave keeps no timer of its own, the
        // next edit IS the retry — there is nothing here for the user to do.
        <div className="app__banner app__banner--failed" role="status">
          <span>Changes are not saved — your next edit retries the whole save.</span>
          <Button size="small" variant="outlined" onClick={() => setFailureDismissed(true)}>
            Dismiss
          </Button>
        </div>
      ) : null}
      <main className="app__canvas">
        {/* Document variables come from here (consumer), via context — shared by
            variables and conditional blocks. `conditions` = the backend decision
            catalog, offered only in the conditional-block builder. */}
        <DocumentVariablesProvider variables={docVariables} conditions={decisionFlags}>
          {/* Review comments: identity + endpoints come from the consumer.
              Context reaches every surface, including the body-portaled
              balloon and the right-rail panel. */}
          <CommentsProvider
            user={MOCK_USER}
            adapter={commentsApi.adapter}
            onFlushNeeded={flushSave}
          >
          <AnchorSyncBinder bind={bindAnchorSync} />
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
            // `onChange` (debounced ~250ms for serialization) only ARMS the
            // autosave window; the pump then snapshots doc + anchors +
            // creates from one editor state (rodada 6's coherence law) and
            // PUTs them as a single transaction.
            onChange={() => scheduleSave()}
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
