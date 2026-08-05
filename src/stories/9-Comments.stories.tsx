import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { BubbleToolbar, DocumentEditor, type DocumentJSON, type EditorApi } from '../editor'
import {
  AnchorFlushBinder,
  CommentsLayer,
  CommentsPanel,
  CommentsProvider,
  type CommentUser,
} from '../features'
import {
  createMockCommentsApi,
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
          'mode is provably zero-write). Writes are DOC-FIRST: the consumer saves the document, ' +
          'and only after that save resolves it calls `flushAnchors()`; per-comment sync states ' +
          '(`pendingSave → saving → synced | saveFailed` + Retry) show on the cards. The mock ' +
          'backend here validates every quote against its SAVED doc — exactly like the real ' +
          "backend will — so `STALE_CONTENT` and the retry flow are demonstrable for real. Use " +
          'the left-rail dashboard: latency slider, per-endpoint failure toggles, the request ' +
          'log (PUT doc always precedes PATCH anchor) and a live `nodes[]` inspector.',
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

/** Latency slider + per-endpoint failure toggles + the request log (the
 *  doc-first proof: `PUT /template` always precedes `PATCH …/anchor`) and an
 *  optional live `nodes[]` inspector over the mock's rows. */
function MockDashboard({ api, showNodes = false }: { api: MockCommentsApi; showNodes?: boolean }) {
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
        {(['save', 'add', 'anchor'] as const).map((kind) => (
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
 * the consumer's DOC-FIRST save pump — `onChange` PUTs the document on the
 * mock, and only after that save resolves it flushes the anchor queue.
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
  const flushRef = useRef<(() => Promise<void>) | null>(null)
  const bind = useCallback((flush: (() => Promise<void>) | null) => {
    flushRef.current = flush
  }, [])
  // ONE doc-first pump for both entry points: organic edits (onChange hands
  // the doc) and provider-requested cycles (queued create, anchor Retry).
  const pump = useCallback(
    (doc?: DocumentJSON) => {
      const json = doc ?? editorApiRef.current?.getJSON()
      if (!json) return
      void api
        .saveTemplate(json)
        .then(() => flushRef.current?.())
        .catch(() => {})
    },
    [api],
  )
  // Console mirror for the demo: on mount and after ANY activity — a comment
  // mutation or a document edit — dump the rows a GET /comments would return
  // AND the current editor JSON. Both deduped on content (subscribe also
  // fires per request-log line, and comment writes never touch the document,
  // so an unchanged side stays silent).
  const editorApiRef = useRef<EditorApi | null>(null)
  const lastDocRef = useRef('')
  const dumpDoc = useCallback(() => {
    const json = editorApiRef.current?.getJSON()
    if (!json) return
    const snapshot = JSON.stringify(json)
    if (snapshot === lastDocRef.current) return
    lastDocRef.current = snapshot
    console.log('[doc] JSON →', json)
  }, [])
  useEffect(() => {
    let last = ''
    const dump = () => {
      const rows = api.peekComments()
      const snapshot = JSON.stringify(rows)
      if (snapshot !== last) {
        last = snapshot
        console.log('[comments api] GET /comments →', rows)
      }
      dumpDoc()
    }
    dump()
    return api.subscribe(dump)
  }, [api, dumpDoc])
  return (
    <Shell>
      <CommentsProvider user={YOU} adapter={api.adapter} onFlushNeeded={pump}>
        <AnchorFlushBinder bind={bind} />
        <DocumentEditor
          features={ALL_FEATURES}
          content={REVIEW_DOC}
          editable={editable}
          onReady={(editorApi) => {
            editorApiRef.current = editorApi
            dumpDoc()
          }}
          onChange={(doc) => {
            dumpDoc()
            // THE DOC-FIRST PUMP: document save first; anchors only after it
            // resolves. A failed doc save leaves the queue untouched.
            pump(doc)
          }}
          renderBubble={(ctx) => (
            <>
              <BubbleToolbar {...ctx} />
              <CommentsLayer editor={ctx.editor} />
            </>
          )}
          renderLeftPanel={() => <MockDashboard api={api} showNodes={showNodes} />}
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
  name: '3. EditMode: pendingSave → saving → synced',
  render: () => <CommentsRig api={storyApi([DEADLINE_ROW])} editable />,
  parameters: {
    docs: {
      description: {
        story:
          'Type INSIDE the commented paragraph (e.g. before "30 days"): the card shows the ' +
          'cycle — clock (`pendingSave`, report queued), spinner (`saving`) once the pump ' +
          'flushes, then nothing (`synced`). The request log proves the doc-first order: ' +
          '`PUT /template` ALWAYS lands before `PATCH /comments/…/anchor`. Raise the latency ' +
          'slider to see each state longer.',
      },
    },
  },
}

export const AnchorFailureRetry: Story = {
  name: '4. Injected anchor failure → Retry',
  render: () => <CommentsRig api={storyApi([DEADLINE_ROW], ['anchor'])} editable />,
  parameters: {
    docs: {
      description: {
        story:
          '"fail anchor" starts TOGGLED ON. Type inside the commented text: the doc saves, the ' +
          'anchor PATCH fails twice (one automatic in-flush retry) and the card lands in ' +
          '`saveFailed` with a warning icon and a **Retry** button. Untoggle "fail anchor", ' +
          'click Retry: the payload is RECOMPUTED from the live document (never replayed), ' +
          'queued, and the next save cycle syncs it — type anything to trigger one.',
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
          'are move-invariant) and the request log shows ZERO `PATCH …/anchor` calls for the ' +
          'move — cut+paste is free. The `nodes[]` inspector never changes.',
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
