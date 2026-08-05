import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import { useFeatureState } from '../hooks/useFeatureState'

/**
 * Where the save cycle stands:
 * - `saved` — nothing outstanding (the initial state).
 * - `saving` — an envelope is in flight.
 * - `failed` — the last envelope was rejected and NOTHING was persisted.
 *   Everything stays queued; the next edit resends fresher state, so there is
 *   no retry to click.
 * - `stopped` — the consumer's {@link DocumentSaveOptions.shouldStop} said so
 *   (typically: another session owns the document now). Saving stops for good
 *   and queued work is settled rather than left hanging.
 */
export type DocumentSaveState = 'saved' | 'saving' | 'failed' | 'stopped'

/** The document half of the envelope — the raw ProseMirror JSON, exactly as
 *  `editor.getJSON()` returns it. Contributed slices are merged in beside it. */
export interface DocumentSaveEnvelope {
  doc: JSONContent
}

/**
 * A feature that needs its own writes to travel WITH the document, in the same
 * transaction (comments' anchors are the shipped example). Registered through
 * {@link useDocumentSaveRegistry}.
 *
 * `collect()` runs in the SAME synchronous frame as the document snapshot —
 * THE COHERENCE LAW. Never make it async: a slice derived one tick later
 * describes a document the envelope is not carrying. Return `null` to sit this
 * cycle out. The `token` comes back on `confirm`/`discard` so a contributor can
 * tell which collect is being settled.
 *
 * The `result` handed to `confirm` is whatever the consumer's `save` resolved
 * with — opaque to the SDK, which only relays it.
 */
export interface DocumentSaveContributor {
  collect(): { token: number; slice: Record<string, unknown> } | null
  confirm(token: number, result: unknown): void
  discard(token: number, options?: { stopped?: boolean }): void
}

export interface DocumentSaveOptions<E extends DocumentSaveEnvelope> {
  /**
   * Persist the envelope. Resolve to confirm (whatever you resolve with reaches
   * the contributors); THROW to reject — nothing was persisted, everything
   * stays queued.
   *
   * Your document's version token lives HERE, in your own closure: the SDK
   * never interpreted it, it only carried it. Read it before the call, advance
   * it from the response.
   */
  save: (envelope: E) => Promise<unknown>
  /** How long an edit burst is allowed to accumulate before a save. Defaults
   *  to 1500ms — the network cadence is the CONSUMER's policy, and it is a much
   *  longer window than the serialization debounce behind `onChange`. */
  debounceMs?: number
  /**
   * "Saving can never succeed from here — stop." Called with whatever `save`
   * threw; saving then stops for good ({@link DocumentSaveState} `stopped`)
   * and contributors settle their queued work instead of waiting on a cycle
   * that will never come. Defaults to never stopping, i.e. the next edit tries
   * again. The SDK has no opinion about the reason — an optimistic-concurrency
   * conflict is your backend's convention, not the editor's.
   */
  shouldStop?: (failure: unknown) => boolean
}

/** What the consumer's UI reads (a banner, a status line). */
export interface DocumentSaveHandle {
  state: DocumentSaveState
  /** Land whatever is pending NOW; resolves when the cycle has settled. */
  flush(): Promise<void>
}

/** The registration seams — SDK-internal, and deliberately split from the
 *  state above: this object NEVER changes identity, so subscribing to it does
 *  not re-run every time the save state moves. */
interface DocumentSaveRegistry {
  /** The editor whose document the envelope carries. Returns the
   *  unregistration (owner-checked: a late cleanup cannot clear a newer
   *  registration). */
  registerEditor(editor: Editor): () => void
  /** Returns the unregistration. */
  registerContributor(contributor: DocumentSaveContributor): () => void
  flush(): Promise<void>
  /**
   * Run a cycle NOW even when nothing is pending — for work that does not
   * change the document and would otherwise wait for an edit that may never
   * come (a comment submitted in edit mode is the shipped case). Distinct from
   * {@link flush} on purpose: flushing an idle editor must stay free, or every
   * mode toggle would cost an empty envelope.
   */
  requestCycle(): Promise<void>
}

const RegistryContext = createContext<DocumentSaveRegistry | null>(null)
const StateContext = createContext<DocumentSaveState>('saved')

/**
 * Owns the save cycle for the document below it: it watches the editor for
 * changes, waits out the burst, snapshots the document together with every
 * contributed slice in ONE synchronous frame, and hands the envelope to your
 * `save`. One envelope flies at a time — overlapping cycles coalesce into a
 * single follow-up, which collects fresher state than either would have
 * carried (and two envelopes in flight would race on the same version token).
 *
 * Optional: without it, nothing autosaves and features that contribute slices
 * fall back to their own immediate writes. It works with or without comments —
 * the document is what it saves.
 */
export function DocumentSaveProvider<E extends DocumentSaveEnvelope = DocumentSaveEnvelope>({
  save,
  debounceMs = 1500,
  shouldStop,
  children,
}: DocumentSaveOptions<E> & { children: ReactNode }) {
  const [state, setState] = useState<DocumentSaveState>('saved')
  // The editor lives in BOTH a ref (the pump reads it synchronously, from a
  // callback that must never change identity) and state (effects below have to
  // re-run when it arrives).
  const [editor, setEditor] = useState<Editor | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const contributorsRef = useRef(new Set<DocumentSaveContributor>())
  // Props via refs so the pump stays identity-stable across renders.
  const saveRef = useRef(save)
  saveRef.current = save
  const shouldStopRef = useRef(shouldStop)
  shouldStopRef.current = shouldStop

  // One envelope in flight at a time, plus "an edit arrived while it flew".
  const savingRef = useRef(false)
  const againRef = useRef(false)
  const stoppedRef = useRef(false)
  const inFlightRef = useRef<Promise<void>>(Promise.resolve())

  const pump = useCallback(function run(): Promise<void> {
    // Stopped means stopped for EVERY entry point (the debounced watcher, a
    // contributor's cycle request, teardown) — nothing restarts the loop.
    if (stoppedRef.current) return inFlightRef.current
    if (savingRef.current) {
      againRef.current = true
      return inFlightRef.current
    }
    const current = editorRef.current
    if (!current || current.isDestroyed) return Promise.resolve()

    // THE COHERENCE LAW: the document and every slice are read back-to-back,
    // synchronously, from the same editor state. Never pair a snapshot taken
    // here with a slice derived a tick later.
    const envelope: Record<string, unknown> = { doc: current.getJSON() }
    const collected: Array<{ contributor: DocumentSaveContributor; token: number }> = []
    for (const contributor of contributorsRef.current) {
      const contribution = contributor.collect()
      if (!contribution) continue
      collected.push({ contributor, token: contribution.token })
      Object.assign(envelope, contribution.slice)
    }

    savingRef.current = true
    setState('saving')
    const cycle = saveRef.current(envelope as E)
      .then((result) => {
        for (const { contributor, token } of collected) contributor.confirm(token, result)
        setState('saved')
      })
      .catch((failure: unknown) => {
        const stop = shouldStopRef.current?.(failure) === true
        // Nothing was persisted. When saving stops for good, whatever the
        // contributors had queued must be settled too — otherwise a promise
        // nobody will ever resolve hangs forever.
        for (const { contributor, token } of collected) {
          contributor.discard(token, stop ? { stopped: true } : undefined)
        }
        if (stop) stoppedRef.current = true
        setState(stop ? 'stopped' : 'failed')
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

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const schedule = useCallback(() => {
    if (stoppedRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      void pump()
    }, debounceMs)
  }, [pump, debounceMs])

  const flush = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
      return pump()
    }
    return inFlightRef.current
  }, [pump])

  const requestCycle = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = undefined
    return pump()
  }, [pump])

  // The change watcher. Subscribing HERE (rather than through the consumer's
  // `onChange`) is what makes the autosave impossible to forget to wire — and
  // it costs no serialization: the document is read once per envelope, at
  // collect time.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const handler = ({
      transaction,
      appendedTransactions,
    }: {
      transaction: { docChanged: boolean }
      appendedTransactions: Array<{ docChanged: boolean }>
    }) => {
      // setEditable also emits 'update' (empty transaction) — a read-only
      // toggle must not look like an edit. Appended transactions count: core
      // can emit with a no-op root whose appended results DID change the doc.
      if (!transaction.docChanged && !appendedTransactions.some((tr) => tr.docChanged)) return
      schedule()
    }
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
    }
  }, [editor, schedule])

  // Leaving edit mode is a natural save point — and a load-bearing one where
  // comments are involved: a review-mode comment is validated against the
  // SAVED document, so the text it quotes must already be on the server.
  const editable = useFeatureState(editor, (current) => current.isEditable)
  useEffect(() => {
    if (editable === false) void flush()
  }, [editable, flush])

  // Nothing typed is lost on teardown: a pending window fires NOW. This runs
  // BEFORE the editor and the contributors below tear down (React unmounts
  // parents first), so the snapshot still has everything it needs.
  const flushRef = useRef(flush)
  flushRef.current = flush
  const requestCycleRef = useRef(requestCycle)
  requestCycleRef.current = requestCycle
  useEffect(
    () => () => {
      void flushRef.current()
    },
    [],
  )

  const registry = useMemo<DocumentSaveRegistry>(
    () => ({
      registerEditor: (next) => {
        editorRef.current = next
        setEditor(next)
        return () => {
          // Owner-checked: a cleanup whose registration was already replaced
          // (StrictMode's double-invoked effects, an editor recreated by a
          // feature-set change) must not blank a LIVE editor.
          if (editorRef.current !== next) return
          editorRef.current = null
          setEditor(null)
        }
      },
      registerContributor: (contributor) => {
        contributorsRef.current.add(contributor)
        return () => {
          contributorsRef.current.delete(contributor)
        }
      },
      flush: () => flushRef.current(),
      requestCycle: () => requestCycleRef.current(),
    }),
    [],
  )

  return (
    <RegistryContext.Provider value={registry}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </RegistryContext.Provider>
  )
}

/**
 * The save cycle as the UI sees it — `null` outside a
 * {@link DocumentSaveProvider}, so a banner can simply render nothing.
 */
export function useDocumentSave(): DocumentSaveHandle | null {
  const registry = useContext(RegistryContext)
  const state = useContext(StateContext)
  return useMemo(
    () => (registry ? { state, flush: registry.flush } : null),
    [registry, state],
  )
}

/** SDK-internal: the stable registration seams (`null` with no provider
 *  above). Identity NEVER changes, so effects that subscribe to it do not
 *  re-run when the save state moves. */
export function useDocumentSaveRegistry(): DocumentSaveRegistry | null {
  return useContext(RegistryContext)
}
