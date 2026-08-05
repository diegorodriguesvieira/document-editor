import type { CommentAnchorPayload, CommentAnchorReport } from './commentAnchor'

/**
 * The DOC-FIRST anchor sync queue — the transport between the reporter (which
 * derives canonical anchor payloads from live editor state and enqueues them
 * here) and the consumer's `updateAnchor` endpoint. Pure TS, no React, no
 * editor.
 *
 * This module knows NOTHING about documents or saving. DOC-FIRST — "no
 * anchor write travels before the document save is confirmed" — is enforced
 * by WHO calls `flush`: the consumer's save pump calls it only AFTER its
 * document save resolves. Between flushes, reports just accumulate.
 *
 * The rules, all load-bearing:
 *
 * - `enqueue` is LATEST-WINS per comment: a newer payload replaces the queued
 *   one and keeps the comment's original position in line — one write per
 *   comment per flush, never a stale payload after a fresh one.
 * - `flush` is SEQUENTIAL — one comment at a time, in enqueue order — and
 *   SNAPSHOTS the line at flush start: a report enqueued mid-flush describes
 *   a doc state whose save has not been confirmed yet, so it waits for the
 *   next flush.
 * - A failed write gets ONE automatic in-flush retry after a short backoff;
 *   failing again marks the comment `saveFailed` (item dequeued) and the
 *   flush CONTINUES with the next comment. No further automatic retries — a
 *   blind retry loop is exactly the error cascade the doc-first design
 *   exists to avoid.
 * - Recovery from `saveFailed` is `retry(id, freshPayload)`: the CALLER
 *   supplies a payload recomputed from live state at retry time — the queue
 *   never resends the payload that failed (the doc may have moved on).
 * - `flush` while flushing CHAINS-AND-COALESCES: every call during a pass
 *   funnels into ONE follow-up pass that starts after the current one ends —
 *   the same comment is never written twice concurrently.
 */

/** Where a comment's anchor stands relative to the backend. `pendingSave` =
 *  queued, waiting for the flush that follows the next confirmed doc save;
 *  `saveFailed` = both in-flush attempts failed, manual retry only. */
export type CommentSyncState = 'synced' | 'pendingSave' | 'saving' | 'saveFailed'

/** Backoff before the single automatic in-flush retry. Overridable through
 *  `retryBackoffMs` (0 skips the wait entirely — pure unit tests). */
export const ANCHOR_RETRY_BACKOFF_MS = 300

export interface CommentSyncQueueDeps {
  /** The network write (the adapter's `updateAnchor`). Reject to fail. */
  updateAnchor(id: string, payload: CommentAnchorPayload): Promise<unknown>
  retryBackoffMs?: number
}

export interface CommentSyncQueue {
  /** Latest-wins per comment; the comment becomes `pendingSave`. */
  enqueue(report: CommentAnchorReport): void
  /** Re-enqueue after `saveFailed` — `freshPayload` MUST be recomputed from
   *  live state by the caller (see the module rules). The write itself waits
   *  for the next flush, i.e. the next confirmed doc save. */
  retry(id: string, freshPayload: CommentAnchorPayload): void
  flush(): Promise<void>
  /** Drop everything — queued payloads, states, errors. Called when the WHOLE
   *  document is replaced (`setJSON`): every queued anchor describes the doc
   *  that just left, and delivering it would patch rows against the wrong
   *  content. A pass already in flight finishes its snapshot; nothing new
   *  follows it. */
  clear(): void
  /** Per-comment states, as a fresh snapshot (safe to hand to React). */
  states(): Map<string, CommentSyncState>
  /** Ids currently queued (pendingSave/saving), in flush order. */
  pendingIds(): string[]
  /** Notified on every state transition. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

export function createCommentSyncQueue(deps: CommentSyncQueueDeps): CommentSyncQueue {
  const backoff = deps.retryBackoffMs ?? ANCHOR_RETRY_BACKOFF_MS
  /** Insertion order IS flush order (Map keeps it; latest-wins `set` on an
   *  existing key does not move the key). */
  const queue = new Map<string, CommentAnchorPayload>()
  const states = new Map<string, CommentSyncState>()
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  const setState = (id: string, state: CommentSyncState) => {
    if (states.get(id) === state) return
    states.set(id, state)
    notify()
  }

  const enqueue = (report: CommentAnchorReport) => {
    queue.set(report.id, { nodes: report.nodes, quote: report.quote })
    setState(report.id, 'pendingSave')
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  async function runFlush(): Promise<void> {
    // Snapshot ENTRIES — the line AND each payload. A report enqueued while
    // this pass runs describes a doc state whose save has not been confirmed
    // yet; it must wait for the next flush EVEN for an id already in this
    // line (reading the latest payload at send time would smuggle an
    // unsaved-doc anchor into the current save's flush).
    for (const [id, sent] of [...queue.entries()]) {
      setState(id, 'saving')
      let failed = false
      try {
        await deps.updateAnchor(id, sent)
      } catch {
        // The one automatic retry: short backoff, SAME snapshotted payload —
        // then saveFailed and ON TO THE NEXT comment.
        if (backoff > 0) await sleep(backoff)
        try {
          await deps.updateAnchor(id, sent)
        } catch {
          failed = true
        }
      }
      if (failed) {
        if (queue.get(id) === sent) {
          // Dequeued: the next flush must NOT auto-retry it again — recovery
          // is the manual `retry(id, freshPayload)`.
          queue.delete(id)
          setState(id, 'saveFailed')
        } else {
          // A fresher payload arrived mid-pass — it earned its own attempt on
          // the next flush; only the superseded failure is recorded.
          setState(id, 'pendingSave')
        }
        continue
      }
      if (queue.get(id) === sent) {
        queue.delete(id)
        setState(id, 'synced')
      } else {
        // A fresher payload landed while this one was in flight — the write
        // that just succeeded is already outdated; back to the line.
        setState(id, 'pendingSave')
      }
    }
  }

  let running: Promise<void> | null = null
  let followUp: Promise<void> | null = null

  const flush = (): Promise<void> => {
    if (running) {
      // Chain-and-coalesce: every flush() during a pass shares ONE follow-up
      // pass scheduled for after it — never two writes for the same comment
      // in flight, never a pile-up of passes.
      followUp ??= running.then(() => {
        followUp = null
        return flush()
      })
      return followUp
    }
    running = runFlush().finally(() => {
      running = null
    })
    return running
  }

  return {
    enqueue,
    retry: (id, freshPayload) => enqueue({ id, ...freshPayload }),
    flush,
    clear: () => {
      queue.clear()
      states.clear()
      notify()
    },
    states: () => new Map(states),
    pendingIds: () => [...queue.keys()],
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
