// uuid stays pinned at 10.0.0 to match @tiptap/extension-unique-id's own
// `uuid: ^10.0.0` and keep a single copy in the tree. v10 is deprecated
// upstream — revisit (and retire @types/uuid) when TipTap bumps its range.
import { v4 as uuidv4 } from 'uuid'
import type { JSONContent } from '@tiptap/core'
import type { DocumentJSON } from './document'

/**
 * Node identity. Every content node — everything except the `doc` root and
 * `text` leaves — mandatorily carries a `uid` attribute: a unique id minted
 * once and kept for the node's lifetime. During editing the UniqueID kernel
 * extension owns the invariant (new/split/pasted nodes get fresh ids); at the
 * JSON boundary these pure helpers own it, so raw documents can enter with
 * ids injected and leave with ids stripped, no editor instance required.
 *
 * The attribute is `uid`, not `id`: `variable`/`signature` already use
 * `attrs.id` as the BUSINESS id (`data-variable`, the condition format's
 * `ref`), and the two meanings must never share a key.
 */
export const NODE_ID_ATTRIBUTE = 'uid'

/** The one place node ids are minted — the kernel's UniqueID `generateID`
 *  and {@link injectNodeIds} both draw from here. */
export function generateNodeId(): string {
  return uuidv4()
}

/** The id-scope rule, single-sourced: `doc` is the envelope itself and text
 *  leaves merge/split on every keystroke — neither can carry a stable id.
 *  The kernel's UniqueID `types` enumeration (buildExtensions) and the test
 *  harness walker both derive from this predicate. */
export function carriesNodeId(type: string | undefined): boolean {
  return type !== 'doc' && type !== 'text'
}

/**
 * A copy of `document` where every content node has a unique `uid`: missing
 * ones are minted, existing ids are preserved, and duplicates are re-minted
 * keeping the first occurrence in document order. Idempotent — a document
 * that already satisfies the invariant comes back deep-equal, which is what
 * lets the entry points (`createEditor` content, `api.setJSON`) run it
 * unconditionally without ever dirtying an already-stamped document.
 *
 * Deliberately schema-agnostic (plain JSON walk, no `Node.fromJSON`): invalid
 * content must still reach TipTap's content check so `onContentError` /
 * setJSON's throw stay the single validation story. That also rules out the
 * package's own `generateUniqueIds` helper — it parses against the schema
 * (throwing before our content check runs) and never re-mints duplicates.
 */
export function injectNodeIds(document: DocumentJSON): DocumentJSON {
  const seen = new Set<string>()

  const visit = (node: JSONContent): JSONContent => {
    const next: JSONContent = { ...node }
    if (carriesNodeId(node.type)) {
      const current = node.attrs?.[NODE_ID_ATTRIBUTE] as unknown
      const keep = typeof current === 'string' && current !== '' && !seen.has(current)
      const uid = keep ? current : generateNodeId()
      seen.add(uid)
      if (uid !== current) next.attrs = { ...node.attrs, [NODE_ID_ATTRIBUTE]: uid }
    }
    if (node.content) next.content = node.content.map(visit)
    return next
  }

  return { ...document, doc: visit(document.doc) }
}

/**
 * A copy of `document` with every `uid` removed — the inverse boundary
 * helper, for pipelines that want id-free JSON (fixtures, diffing, content
 * dedup). Drops `attrs` entirely when `uid` was its only key, so stripping
 * an injected document restores the raw shape: `stripNodeIds(injectNodeIds(x))`
 * deep-equals `x` for any id-free `x`.
 */
export function stripNodeIds(document: DocumentJSON): DocumentJSON {
  const visit = (node: JSONContent): JSONContent => {
    const next: JSONContent = { ...node }
    if (next.attrs && NODE_ID_ATTRIBUTE in next.attrs) {
      const { [NODE_ID_ATTRIBUTE]: _uid, ...rest } = next.attrs
      if (Object.keys(rest).length > 0) next.attrs = rest
      else delete next.attrs
    }
    if (node.content) next.content = node.content.map(visit)
    return next
  }

  return { ...document, doc: visit(document.doc) }
}
