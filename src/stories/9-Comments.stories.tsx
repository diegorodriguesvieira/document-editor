import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { BubbleToolbar, DocumentEditor, type DocumentJSON, type EditorApi } from '../editor'
import {
  AnchorSyncBinder,
  CommentsLayer,
  CommentsPanel,
  CommentsProvider,
  type CommentAnchorSync,
  type CommentUser,
} from '../features'
import {
  createMockCommentsApi,
  VERSION_CONFLICT,
  type MockCommentsApi,
  type MockFailureKind,
  type StoredComment,
} from '../app/commentsMock'
import { ALL_FEATURES, Shell } from './storyShell'

const meta = {
  title: 'Editor/9. Comments',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Comments are 100% ANCHOR-BASED: nothing about a comment lives in the document. Each ' +
          'backend row carries `nodes: [{id, from, to}]` — node `uid` plus node-local offsets — ' +
          'and the SDK resolves them into decorations (never marks, never serialized: review ' +
          'mode is provably zero-write). Writes travel in ONE ATOMIC ENVELOPE: a single ' +
          '`PUT /template` carries the document, every anchor that drifted since the last save ' +
          'and every comment queued for creation — the backend writes all of it or none of it. ' +
          'Per-comment states on the cards are `pendingSave → saving → (gone)`; a failed ' +
          'envelope persists NOTHING, so the autosave just retries wholesale with fresher ' +
          'state — there is no per-anchor recovery to click. The mock backend here validates ' +
          'every quote against the document IN THE REQUEST and guards a `versionId` — exactly ' +
          'like the real backend will — so `STALE_CONTENT` and the failure flow are ' +
          'demonstrable for real. Use the left-rail dashboard: latency slider, per-endpoint ' +
          'failure toggles, the autosave state (with an "another session saves" button that ' +
          'provokes a real version conflict), the request log (one envelope PUT carries doc + ' +
          'anchors + creates) and a live `nodes[]` inspector.',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

const YOU: CommentUser = { id: 'u-you', name: 'You' }
const RITA: CommentUser = { id: 'u-reviewer', name: 'Rita Reviewer' }

/* Content under review — EXPLICIT uids, because the seeded rows' `nodes[]`
 * point at them (injectNodeIds keeps unique explicit ids verbatim). */
const REVIEW_DOC: DocumentJSON = {
  doc: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1, uid: 'n-title' },
        content: [{ type: 'text', text: 'Review me' }],
      },
      {
        type: 'paragraph',
        attrs: { uid: 'n-deadline' },
        content: [{ type: 'text', text: 'The delivery deadline is 30 days after signature.' }],
      },
      {
        type: 'paragraph',
        attrs: { uid: 'n-terms' },
        content: [
          { type: 'text', text: 'Payment terms follow the master agreement.' },
        ],
      },
      {
        type: 'paragraph',
        attrs: { uid: 'n-liability' },
        content: [
          { type: 'text', text: 'Liability is capped at the fees paid in the last twelve months.' },
        ],
      },
    ],
  },
}

/** "30 days" inside the deadline paragraph (content offsets 25..32). */
const DEADLINE_ROW: StoredComment = {
  id: 'c-deadline',
  quote: '30 days',
  text: 'Can we make this 15 days?',
  author: RITA,
  createdAt: '2026-07-15T12:00:00Z',
  status: 'OPEN',
  nodes: [{ id: 'n-deadline', from: 25, to: 32 }],
  replies: [
    { id: 'r-1', text: 'Checking with legal, one sec.', author: YOU, createdAt: '2026-07-15T14:00:00Z' },
  ],
}

/** ONE comment, TWO segments: "Payment terms" + "Liability" — the
 *  multi-segment shape a split (or copy-extend) produces. */
const MULTI_ROW: StoredComment = {
  id: 'c-multi',
  quote: 'Payment termsLiability',
  text: 'These two clauses contradict each other.',
  author: RITA,
  createdAt: '2026-07-16T09:00:00Z',
  status: 'OPEN',
  nodes: [
    { id: 'n-terms', from: 0, to: 13 },
    { id: 'n-liability', from: 0, to: 9 },
  ],
  replies: [],
}

/** One mock per story mount — module scope would leak rows across stories. */
const storyApi = (seed: StoredComment[], failing: MockFailureKind[] = []) => {
  const api = createMockCommentsApi({
    sessionUser: YOU,
    seed,
    template: REVIEW_DOC,
    latencyMs: 400,
  })
  for (const kind of failing) api.failNext.add(kind)
  return api
}

/* ── The left-rail dashboard: knobs + log + nodes[] inspector ─────────── */

const dashStyles: Record<string, React.CSSProperties> = {
  root: {
    width: 260,
    padding: '12px 14px',
    fontFamily: 'ui-monospace, monospace',
    fontSize: 11,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    color: '#333',
  },
  block: { display: 'flex', flexDirection: 'column', gap: 4 },
  alarm: { color: '#8c1d18', fontWeight: 700 },
  pre: {
    margin: 0,
    padding: 8,
    background: '#f6f6f6',
    border: '1px solid #e0e0e0',
    borderRadius: 6,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    maxHeight: 220,
    overflowY: 'auto',
  },
}

/** How the consumer's autosave is doing — the rig owns it, the dashboard
 *  shows it. `conflict` is terminal: another session saved, so every retry
 *  would be rejected the same way. */
type SaveStatus = 'saved' | 'failed' | 'conflict'

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: 'up to date',
  failed: 'NOT SAVED — the next edit retries the whole envelope',
  conflict: 'VERSION CONFLICT — reload to continue from the latest version',
}

/** Latency slider + per-endpoint failure toggles + the autosave state (with
 *  the "another session saved" button that provokes a stale `versionId`) + the
 *  request log (the envelope proof: ONE `PUT /template (envelope)` per save
 *  cycle, carrying the doc, the moved anchors and the queued creates together)
 *  and an optional live `nodes[]` inspector over the mock's rows. */
function MockDashboard({
  api,
  save,
  onOtherSessionSaves,
  showNodes = false,
}: {
  api: MockCommentsApi
  save: SaveStatus
  onOtherSessionSaves: () => void
  showNodes?: boolean
}) {
  const [, force] = useReducer((tick: number) => tick + 1, 0)
  useEffect(() => api.subscribe(force), [api])
  const [latency, setLatency] = useState(api.latencyMs)
  const toggle = (kind: MockFailureKind) => {
    if (api.failNext.has(kind)) api.failNext.delete(kind)
    else api.failNext.add(kind)
    force()
  }
  return (
    <div style={dashStyles.root}>
      <strong>Mock backend</strong>
      <label style={dashStyles.block}>
        latency: {latency}ms
        <input
          type="range"
          min={0}
          max={2000}
          step={100}
          value={latency}
          onChange={(event) => {
            const value = Number(event.target.value)
            setLatency(value)
            api.latencyMs = value
          }}
        />
      </label>
      <div style={dashStyles.block}>
        {(['save', 'add'] as const).map((kind) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={api.failNext.has(kind)}
              onChange={() => toggle(kind)}
            />{' '}
            fail {kind}
          </label>
        ))}
      </div>
      <div style={dashStyles.block}>
        <strong>autosave</strong>
        <span style={save === 'saved' ? undefined : dashStyles.alarm}>{SAVE_LABEL[save]}</span>
        {/* Optimistic concurrency, demonstrable: this saves the CURRENT
            document as somebody else's session, which bumps the server's
            version past the token this rig is holding — the next envelope it
            sends is then rejected wholesale. */}
        <button type="button" onClick={onOtherSessionSaves}>
          another session saves
        </button>
      </div>
      {showNodes ? (
        <div style={dashStyles.block}>
          <strong>nodes[] (server rows)</strong>
          <pre style={dashStyles.pre}>
            {JSON.stringify(
              api.peekComments().map(({ id, quote, nodes, isDeleted }) => ({
                id,
                quote,
                nodes,
                ...(isDeleted ? { isDeleted } : {}),
              })),
              null,
              1,
            )}
          </pre>
        </div>
      ) : null}
      <div style={dashStyles.block}>
        <strong>request log</strong>
        <pre style={dashStyles.pre}>{api.log.slice(-14).join('\n') || '(no calls yet)'}</pre>
      </div>
    </div>
  )
}


/**
 * The one rig every story mounts: editor + balloon + panel + dashboard, with
 * the consumer's ENVELOPE save pump — `onChange` snapshots the document, the
 * drifted anchors and the queued creates from ONE editor state and PUTs them
 * as a single transaction.
 */
function CommentsRig({
  api,
  editable,
  showNodes = false,
}: {
  api: MockCommentsApi
  editable: boolean
  showNodes?: boolean
}) {
  const syncRef = useRef<CommentAnchorSync | null>(null)
  const bind = useCallback((sync: CommentAnchorSync | null) => {
    syncRef.current = sync
  }, [])
  const [save, setSave] = useState<SaveStatus>('saved')
  /** THE SAVE CADENCE is the consumer's policy: `onChange` is debounced for
   *  SERIALIZATION (250ms — getJSON is O(n)), which is far too eager for a
   *  network write, so every edit burst funnels through this longer window.
   *  A comment submitted by the user (onFlushNeeded) pumps immediately. */
  const AUTOSAVE_MS = 1500
  // The version this session edits on top of — read once, then advanced by
  // every accepted save. Sending `api.versionId` instead would make the client
  // permanently "current" and the conflict guard unreachable.
  const versionRef = useRef(api.versionId)
  const conflictRef = useRef(false)
  // One envelope in flight at a time (see below), plus "an edit arrived while
  // it flew".
  const savingRef = useRef(false)
  const againRef = useRef(false)
  // THE ENVELOPE PUMP: snapshot doc + dirty anchors + queued creates from ONE
  // editor state, PUT them as a single transaction, confirm on success —
  // discard on failure (nothing persisted; the next cycle resends fresher).
  // SERIALIZED: overlapping cycles would carry the same version token, so the
  // second would come back as a conflict that never happened — they coalesce
  // into one follow-up instead.
  const inFlightRef = useRef<Promise<void>>(Promise.resolve())
  const pump = useCallback(
    function run(): Promise<void> {
      if (conflictRef.current) return inFlightRef.current
      if (savingRef.current) {
        againRef.current = true
        return inFlightRef.current
      }
      const sync = syncRef.current
      const payload = sync?.collectSavePayload()
      if (!sync || !payload) return Promise.resolve()
      savingRef.current = true
      const cycle = api
        .saveEnvelope({
          versionId: versionRef.current,
          doc: payload.doc,
          anchors: payload.anchors,
          creates: payload.creates,
        })
        .then((result) => {
          versionRef.current = result.versionId
          sync.confirmSaved(payload.token, result)
          setSave('saved')
        })
        .catch((failure: unknown) => {
          const conflict = (failure as { code?: unknown } | null)?.code === VERSION_CONFLICT
          // Terminal on conflict: the pump stops, so anything queued must be
          // settled rather than left hanging.
          sync.discardSave(payload.token, conflict ? { terminal: true } : undefined)
          if (conflict) conflictRef.current = true
          setSave(conflict ? 'conflict' : 'failed')
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
    },
    [api],
  )

  // Arm the autosave window (see AUTOSAVE_MS).
  const pumpTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scheduleSave = useCallback(() => {
    clearTimeout(pumpTimerRef.current)
    pumpTimerRef.current = setTimeout(() => {
      pumpTimerRef.current = undefined
      void pump()
    }, AUTOSAVE_MS)
  }, [pump])
  /** Land what is pending NOW and resolve when it has — the provider awaits
   *  this before a REVIEW-mode create (validated against the SAVED doc). */
  const flushSave = useCallback(() => {
    if (pumpTimerRef.current !== undefined) {
      clearTimeout(pumpTimerRef.current)
      pumpTimerRef.current = undefined
      return pump()
    }
    return inFlightRef.current
  }, [pump])
  // Nothing typed is lost on teardown.
  useEffect(
    () => () => {
      void flushSave()
    },
    [flushSave],
  )

  // The live editor api — the "another session saves" knob and the console
  // mirror below read the current document through it.
  const editorApiRef = useRef<EditorApi | null>(null)

  /* The document, live in the console — the backend trace only shows what
   * CROSSED THE WIRE (the envelope's doc, once a save runs), so this is the
   * "what does the editor hold right now" half. Deduped: the JSON prints only
   * when it actually changed. */
  const lastDocRef = useRef('')
  const dumpDoc = useCallback(() => {
    const json = editorApiRef.current?.getJSON()
    if (!json) return
    const snapshot = JSON.stringify(json)
    if (snapshot === lastDocRef.current) return
    lastDocRef.current = snapshot
    console.groupCollapsed(
      '%c◆ editor doc (live)%c',
      'padding:1px 5px;border-radius:3px;font-weight:600;background:#5f6368;color:#fff',
      'color:inherit',
    )
    console.log(json.doc)
    console.groupEnd()
  }, [])
  // Saves the CURRENT document as if it came from another tab / someone
  // else's session. The server's version moves past this rig's token, so its
  // next envelope is rejected — nothing this session does can save again.
  const otherSessionSaves = useCallback(() => {
    const json = editorApiRef.current?.getJSON()
    if (!json) return
    // Deterministic for the demo: if the rig's own envelope wins the race and
    // bumps the version first, this save is itself rejected — retry ONCE with
    // the fresh token so the button always does what it says.
    const saveAsOther = () =>
      api.saveEnvelope({ versionId: api.versionId, doc: json.doc, anchors: [], creates: [] })
    void saveAsOther().catch(() => saveAsOther().catch(() => {}))
  }, [api])

  return (
    <Shell>
      <CommentsProvider user={YOU} adapter={api.adapter} onFlushNeeded={flushSave}>
        <AnchorSyncBinder bind={bind} />
        <DocumentEditor
          features={ALL_FEATURES}
          content={REVIEW_DOC}
          editable={editable}
          onReady={(editorApi) => {
            editorApiRef.current = editorApi
            dumpDoc()
          }}
          onChange={() => {
            dumpDoc()
            scheduleSave()
          }}
          renderBubble={(ctx) => (
            <>
              <BubbleToolbar {...ctx} />
              <CommentsLayer editor={ctx.editor} />
            </>
          )}
          renderLeftPanel={() => (
            <MockDashboard
              api={api}
              save={save}
              onOtherSessionSaves={otherSessionSaves}
              showNodes={showNodes}
            />
          )}
          renderRightPanel={(ctx) => <CommentsPanel editor={ctx.editor} />}
        />
      </CommentsProvider>
    </Shell>
  )
}

/* ── The 8 required stories (plan §8) ─────────────────────────────────── */

export const CardClickLightsSegments: Story = {
  name: '1. Card click → segments light + scroll',
  render: () => <CommentsRig api={storyApi([DEADLINE_ROW, MULTI_ROW])} editable={false} />,
  parameters: {
    docs: {
      description: {
        story:
          "Click Rita's multi-segment card in the sidebar: EVERY segment of the comment lights " +
          'up (`comment--active` on each slice) and the document scrolls to the FIRST segment ' +
          'in document order. The single-segment card works the same with one range.',
      },
    },
  },
}

export const HighlightClickScrollsSidebar: Story = {
  name: '2. Highlight click → sidebar card',
  render: () => <CommentsRig api={storyApi([DEADLINE_ROW, MULTI_ROW])} editable={false} />,
  parameters: {
    docs: {
      description: {
        story:
          'Click any highlight in the document — including EITHER segment of the multi-segment ' +
          'comment (the slices carry `data-comment-ids`, so both resolve to the same card): the ' +
          'sidebar scrolls to the matching card and marks it active. Clicking plain text ' +
          'deactivates.',
      },
    },
  },
}

export const EditModeSyncCycle: Story = {
  name: '3. EditMode: pendingSave → saving → no badge',
  render: () => <CommentsRig api={storyApi([DEADLINE_ROW])} editable />,
  parameters: {
    docs: {
      description: {
        story:
          'Type INSIDE the commented paragraph (e.g. before "30 days"): the card shows the ' +
          'cycle — clock (`pendingSave`: the anchor drifted and rides the next save), spinner ' +
          '(`saving`: the envelope carrying it is in flight), then nothing once the save is ' +
          'confirmed — and the dashboard\'s autosave line goes back to "up to date". The ' +
          'request log shows the whole cycle as ONE `PUT /template (envelope)`: the moved ' +
          'anchor travels with the very document it was derived from, so there is no second ' +
          'call to order against. Raise the latency slider to see each state longer — typing ' +
          'through a slow save is safe, the cycles coalesce instead of overlapping.',
      },
    },
  },
}

export const SaveFailureAndConflict: Story = {
  name: '4. Save failure → retry; another session → conflict',
  render: () => <CommentsRig api={storyApi([DEADLINE_ROW], ['save'])} editable />,
  parameters: {
    docs: {
      description: {
        story:
          '"fail save" starts TOGGLED ON. Type inside the commented text: the envelope is ' +
          'rejected and NOTHING is persisted — not the document, not the anchor — so the ' +
          'dashboard reads "NOT SAVED", the card keeps its clock (`pendingSave`) and every ' +
          'queued write stays queued. There is no per-card Retry to click, by design: ' +
          'untoggle "fail save" and type again, and the next cycle collects FRESH state (the ' +
          'rejected payload is never replayed) and lands doc and anchor together in one ' +
          'transaction. Then press **"another session saves"**: the server version moves past ' +
          'the token this session holds, so its next envelope comes back as a VERSION ' +
          'CONFLICT — and saving STOPS. That one is not retryable: another session owns the ' +
          'document now, and the only way forward is to reload onto the version that won.',
      },
    },
  },
}

export const SplitMergeNodes: Story = {
  name: '5. Split/merge → nodes[] follows',
  render: () => <CommentsRig api={storyApi([DEADLINE_ROW])} editable showNodes />,
  parameters: {
    docs: {
      description: {
        story:
          'Split the commented paragraph with Enter in the middle of the highlight: after the ' +
          'save cycle the `nodes[]` inspector shows TWO segments (the second under the fresh ' +
          "uid the split minted). Backspace the split away: the segments coalesce back to ONE " +
          '— `nodes[]` stays bounded through split/merge cycles.',
      },
    },
  },
}

export const CutPasteZeroTraffic: Story = {
  name: '6. Cut+paste → restored, zero writes',
  render: () => <CommentsRig api={storyApi([DEADLINE_ROW])} editable showNodes />,
  parameters: {
    docs: {
      description: {
        story:
          'Select the WHOLE commented paragraph, cut it (⌘X) — the card goes orphaned — and ' +
          'paste it somewhere else: the highlight is RESTORED (the node uid reappears; offsets ' +
          'are move-invariant) and the card never badges — the envelopes the move produces ' +
          'carry an EMPTY `anchors[]`, so cut+paste costs no anchor write at all. The ' +
          '`nodes[]` inspector never changes.',
      },
    },
  },
}

export const CopyPasteExtends: Story = {
  name: '7. Copy+paste → comment points at both',
  render: () => <CommentsRig api={storyApi([DEADLINE_ROW])} editable showNodes />,
  parameters: {
    docs: {
      description: {
        story:
          'Select the commented text (or the whole paragraph), copy (⌘C) and paste it at the ' +
          'end of the document: the SAME comment extends onto the copy — both highlights ' +
          'light up for one card, whether the paste merged into an existing block or ' +
          'materialized a new one. After the save cycle the `nodes[]` inspector shows the ' +
          "extra segment under the copy's uid. Resolving/deleting the comment affects every " +
          'occurrence (decided trade-off).',
      },
    },
  },
}

export const DeleteTextOrphan: Story = {
  name: '8. Delete commented text → orphan card',
  render: () => <CommentsRig api={storyApi([DEADLINE_ROW])} editable />,
  parameters: {
    docs: {
      description: {
        story:
          'Select "30 days" and delete it: the highlight dies for good (typing new text at the ' +
          'same spot never re-lights it — the anti-ghost rule) and the card persists as an ' +
          'ORPHAN: original quote + "Original text was removed", still replyable and ' +
          'deletable. Orphan-forever is the intended semantics; only undo (or the text\'s uid ' +
          'reappearing via paste) revives the anchor.',
      },
    },
  },
}
