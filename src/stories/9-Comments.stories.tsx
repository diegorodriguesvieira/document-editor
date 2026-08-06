import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  BubbleToolbar,
  DocumentEditor,
  DocumentSaveProvider,
  useDocumentSave,
  type DocumentJSON,
  type DocumentSaveState,
  type EditorApi,
} from '../editor'
import { CommentsLayer, CommentsPanel, CommentsProvider, type CommentUser } from '../features'
import {
  createMockCommentsApi,
  isVersionConflict,
  type MockCommentsApi,
  type MockFailureKind,
  type SaveEnvelope,
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
          'anchors + creates) and a live `nodes[]` inspector.' +
          '\n\n' +
          'The cycle itself belongs to `DocumentSaveProvider` — the consumer brings a `save` ' +
          'function, a cadence and an optional `shouldStop`; the debounce, the one-envelope-in-' +
          'flight rule, the flush on teardown and on leaving edit mode are the SDK\'s, and the ' +
          'editor registers itself, so there is no `onChange` to remember to wire. Its state ' +
          'is on the dashboard: `saved` is the ONLY value meaning the server has everything — ' +
          'watch it sit on `unsaved — waiting out the save window` (`pending`) between a ' +
          'keystroke and the PUT. One prop is deliberately NOT enabled here: ' +
          '`warnBeforeUnload` asks the browser to confirm before a dirty tab is closed or ' +
          'reloaded (anything other than `saved`). It would fire on every Storybook refresh ' +
          'and demonstrate nothing — Storybook navigation is client-side. Turn it on in your ' +
          'own app; note that it WARNS without saving (`beforeunload` cannot await a promise) ' +
          'and that the dialog\'s text is the browser\'s: custom messages left the platform ' +
          'years ago. For wording of your own, guard your in-app navigation with ' +
          '`useDocumentSave().state`.',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

const YOU: CommentUser = { id: 'u-you', name: 'You' }
const RITA: CommentUser = { id: 'u-reviewer', name: 'Rita Reviewer' }

/* Shorthands for the filler around the anchored clauses — long enough that the
 * document actually SCROLLS, which is what makes "click a card → the document
 * scrolls to the segment" (and the sticky header/footer, and zoom) testable
 * by hand. Explicit uids throughout: deterministic, and anchorable later. */
type Block = DocumentJSON['doc']
const head = (uid: string, text: string): Block => ({
  type: 'heading',
  attrs: { level: 2, uid },
  content: [{ type: 'text', text }],
})
const para = (uid: string, text: string): Block => ({
  type: 'paragraph',
  attrs: { uid },
  content: [{ type: 'text', text }],
})

/* Content under review. The three ANCHORED paragraphs (`n-deadline`,
 * `n-terms`, `n-liability`) keep their uids AND their text verbatim — the
 * seeded rows below point at them by offset, and the mock backend validates
 * every quote against this document, so a single edited character here breaks
 * both. They sit far apart on purpose: the multi-segment comment then spans
 * opposite ends of the page, and clicking its card has somewhere to scroll. */
const REVIEW_DOC: DocumentJSON = {
  doc: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1, uid: 'n-title' },
        content: [{ type: 'text', text: 'Review me' }],
      },
      para(
        'n-preamble',
        'This agreement is entered into by the parties named above and governs the supply of ' +
          'the services described in the schedule. It replaces every prior understanding on ' +
          'the same subject, written or otherwise.',
      ),
      head('n-h-delivery', '1. Delivery'),
      {
        type: 'paragraph',
        attrs: { uid: 'n-deadline' },
        content: [{ type: 'text', text: 'The delivery deadline is 30 days after signature.' }],
      },
      para(
        'n-delivery-2',
        'Partial deliveries are accepted only where the schedule provides for them, and each ' +
          'one is invoiced separately. A delivery is complete when the supplier hands over ' +
          'every artefact listed for that milestone.',
      ),
      para(
        'n-delivery-3',
        'Delay caused by the client — late approvals, missing access, unavailable staff — ' +
          'moves the deadline by the same number of working days, and the supplier must say ' +
          'so in writing within five days of the cause.',
      ),
      head('n-h-acceptance', '2. Acceptance'),
      para(
        'n-acceptance-1',
        'The client has ten working days from delivery to accept or reject. Silence past that ' +
          'window counts as acceptance, and acceptance starts the payment clock.',
      ),
      para(
        'n-acceptance-2',
        'A rejection must list the defects and point at the requirement each one misses. ' +
          'Disagreement about whether something is a defect goes to the escalation path in ' +
          'clause 7 before it goes anywhere else.',
      ),
      head('n-h-payment', '3. Payment'),
      {
        type: 'paragraph',
        attrs: { uid: 'n-terms' },
        content: [{ type: 'text', text: 'Payment terms follow the master agreement.' }],
      },
      para(
        'n-payment-2',
        'Invoices are issued on acceptance and settled within thirty days. Amounts genuinely ' +
          'in dispute may be withheld; the rest of the invoice may not.',
      ),
      para(
        'n-payment-3',
        'Late payment accrues interest at the statutory rate, and the supplier may suspend ' +
          'work after giving fifteen days of written notice that goes unanswered.',
      ),
      head('n-h-confidentiality', '4. Confidentiality'),
      para(
        'n-conf-1',
        'Each party keeps the other party’s confidential information to itself, uses it ' +
          'only to perform this agreement, and protects it at least as carefully as it ' +
          'protects its own.',
      ),
      para(
        'n-conf-2',
        'The duty survives termination by three years, and does not cover information that ' +
          'was already public, was already known, or was independently developed without ' +
          'reference to the disclosure.',
      ),
      head('n-h-ip', '5. Intellectual property'),
      para(
        'n-ip-1',
        'Deliverables become the client’s property on payment in full. Everything the ' +
          'supplier brought with it — tools, libraries, know-how — stays the supplier’s, ' +
          'licensed to the client for as long as the deliverables are used.',
      ),
      head('n-h-liability', '6. Liability'),
      {
        type: 'paragraph',
        attrs: { uid: 'n-liability' },
        content: [
          { type: 'text', text: 'Liability is capped at the fees paid in the last twelve months.' },
        ],
      },
      para(
        'n-liability-2',
        'The cap does not apply to death or personal injury, to fraud, or to a breach of the ' +
          'confidentiality clause — nothing in this agreement limits what the law says cannot ' +
          'be limited.',
      ),
      head('n-h-escalation', '7. Escalation and termination'),
      para(
        'n-esc-1',
        'Disputes go first to the named contacts, then to the signatories, and only then to ' +
          'the courts named in clause 9. Each step gets ten working days before the next one ' +
          'opens.',
      ),
      para(
        'n-esc-2',
        'Either party may terminate for a material breach that is still unremedied thirty ' +
          'days after written notice, and either may terminate for convenience with ninety ' +
          'days of notice.',
      ),
      para(
        'n-esc-3',
        'On termination the supplier hands over work in progress and the client pays for ' +
          'everything accepted or in flight up to that date.',
      ),
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

/** How the autosave is doing, straight from the SDK's save layer. `stopped` is
 *  for good: another session saved, so every retry would be rejected the same
 *  way. */
const SAVE_LABEL: Record<DocumentSaveState, string> = {
  saved: 'up to date',
  pending: 'unsaved — waiting out the save window',
  saving: 'saving…',
  failed: 'NOT SAVED — the next edit retries the whole envelope',
  stopped: 'VERSION CONFLICT — reload to continue from the latest version',
}

/** Latency slider + per-endpoint failure toggles + the autosave state (with
 *  the "another session saved" button that provokes a stale `versionId`) + the
 *  request log (the envelope proof: ONE `PUT /template (envelope)` per save
 *  cycle, carrying the doc, the moved anchors and the queued creates together)
 *  and an optional live `nodes[]` inspector over the mock's rows. */
function MockDashboard({
  api,
  onOtherSessionSaves,
  showNodes = false,
  showUnloadProbe = false,
}: {
  api: MockCommentsApi
  onOtherSessionSaves: () => void
  showNodes?: boolean
  showUnloadProbe?: boolean
}) {
  const [, force] = useReducer((tick: number) => tick + 1, 0)
  useEffect(() => api.subscribe(force), [api])
  // The save state comes from the SDK — the rig keeps no copy of it.
  const save = useDocumentSave()?.state ?? 'saved'
  /* Asks the PAGE whether it would stop someone leaving right now: dispatching
   * a cancelable `beforeunload` runs the listeners without opening the real
   * dialog (only an actual reload/close does that). It is the same probe a
   * test would use — and the only way to watch the guard arm and release
   * without fighting a browser modal. */
  const [leaving, setLeaving] = useState<'blocked' | 'free' | null>(null)
  const probeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    setLeaving(event.defaultPrevented ? 'blocked' : 'free')
  }
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
      {showUnloadProbe ? (
        <div style={dashStyles.block}>
          <strong>leave-page guard</strong>
          <button type="button" onClick={probeUnload}>
            would leaving be blocked?
          </button>
          {leaving ? (
            <span style={leaving === 'blocked' ? dashStyles.alarm : undefined}>
              {leaving === 'blocked'
                ? 'BLOCKED — the browser would ask to confirm'
                : 'free — everything is on the server'}
            </span>
          ) : null}
        </div>
      ) : null}
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
 * The one rig every story mounts: editor + balloon + panel + dashboard, under
 * the SDK's save layer. Note how little wiring the ENVELOPE costs the
 * consumer — one `save` function (the endpoint plus its version token) and a
 * cadence. Collecting the document, the drifted anchors and the queued
 * creates from ONE editor state and PUTting them as a single transaction is
 * the SDK's job, and there is no way to forget to connect it.
 */
function CommentsRig({
  api,
  editable,
  showNodes = false,
  warnBeforeUnload = false,
}: {
  api: MockCommentsApi
  editable: boolean
  showNodes?: boolean
  /** Opt-in per story: it would otherwise prompt on every Storybook refresh. */
  warnBeforeUnload?: boolean
}) {
  /** THE SAVE CADENCE is the consumer's policy — a network write should not
   *  fire on every typing pause. Everything else about the cycle (one envelope
   *  in flight, coalescing, stopping for good, the teardown flush) is the
   *  SDK's. */
  const AUTOSAVE_MS = 1500
  // The version this session edits on top of — read once, then advanced by
  // every accepted save. Sending `api.versionId` instead would make the client
  // permanently "current" and the conflict guard unreachable. It lives here,
  // in the save closure: the SDK carries the envelope, it never reads it.
  const versionRef = useRef(api.versionId)
  const save = useCallback(
    async (envelope: Omit<SaveEnvelope, 'versionId'>) => {
      const result = await api.saveEnvelope({ versionId: versionRef.current, ...envelope })
      versionRef.current = result.versionId
      return result
    },
    [api],
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
      {/* The save layer sits ABOVE: the envelope is the DOCUMENT's save, and
          comments merely contributes its anchors and queued creates to it.
          A stale version stops saving — every retry would be rejected alike. */}
      <DocumentSaveProvider
        save={save}
        debounceMs={AUTOSAVE_MS}
        shouldStop={isVersionConflict}
        warnBeforeUnload={warnBeforeUnload}
      >
        <CommentsProvider user={YOU} adapter={api.adapter}>
          <DocumentEditor
            features={ALL_FEATURES}
            content={REVIEW_DOC}
            editable={editable}
            onReady={(editorApi) => {
              editorApiRef.current = editorApi
              dumpDoc()
            }}
            // Only the console mirror — the autosave watches the editor itself.
            onChange={dumpDoc}
            renderBubble={(ctx) => (
              <>
                <BubbleToolbar {...ctx} />
                <CommentsLayer editor={ctx.editor} />
              </>
            )}
            renderLeftPanel={() => (
              <MockDashboard
                api={api}
                onOtherSessionSaves={otherSessionSaves}
                showNodes={showNodes}
                showUnloadProbe={warnBeforeUnload}
              />
            )}
            renderRightPanel={(ctx) => <CommentsPanel editor={ctx.editor} />}
          />
        </CommentsProvider>
      </DocumentSaveProvider>
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

export const LeavePageGuard: Story = {
  name: '9. warnBeforeUnload → leaving a dirty tab',
  render: () => (
    <CommentsRig api={storyApi([DEADLINE_ROW])} editable warnBeforeUnload showNodes={false} />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The ONE story with `warnBeforeUnload` on — it is off everywhere else because it ' +
          'would prompt on every Storybook refresh. Type in the document and press **"would ' +
          'leaving be blocked?"** in the dashboard: it answers BLOCKED. Wait for the autosave ' +
          'line to go back to "up to date" and press it again: free. That button dispatches a ' +
          'cancelable `beforeunload` and reports whether anything cancelled it — the same ' +
          'probe a test uses — so you can watch the guard arm and release without fighting a ' +
          'browser modal. (A real ⌘R while dirty shows the actual dialog.) Three things worth ' +
          'knowing: the guard covers `pending` too, so it is armed from the KEYSTROKE, not ' +
          'from when the envelope leaves — try the probe immediately after typing, well ' +
          'inside the save window. It stays armed after a rejected save (toggle "fail save": ' +
          'nothing was persisted, so leaving still loses work). And it only WARNS — ' +
          '`beforeunload` cannot await a promise, so nothing is saved from inside it, and the ' +
          "dialog's text is the browser's: custom messages left the platform years ago.",
      },
    },
  },
}
