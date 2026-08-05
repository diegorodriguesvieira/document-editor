import type { Node as PMNode } from '@tiptap/pm/model'
import { NODE_ID_ATTRIBUTE, carriesNodeId } from './nodeIds'

/** One uid occurrence: the node and its position — the position BEFORE the
 *  node, exactly as `doc.descendants` reports it (so `doc.nodeAt(pos)` is the
 *  node, and the node's content starts at `pos + 1`). */
export interface NodeIdEntry {
  pos: number
  node: PMNode
}

export interface NodeIdIndex {
  /** FIRST occurrence of each uid in document order — the occurrence every
   *  first-wins policy (entry injection, runtime collision rule) retains. */
  byId: Map<string, NodeIdEntry>
  /** uids held by MORE than one node — the collision set. Empty on any
   *  document that satisfies the uniqueness invariant. */
  duplicated: Set<string>
}

/** ProseMirror documents are immutable persistent structures — a doc node is
 *  never mutated in place, every change produces a NEW doc — so an index is
 *  valid for exactly as long as its doc identity, and a WeakMap keyed by the
 *  doc both memoizes repeat lookups (the uid extension, and later the
 *  comments plugin, share one walk per doc version) and lets dead versions
 *  be collected with their index. */
const indexCache = new WeakMap<PMNode, NodeIdIndex>()

/**
 * The uid → node index of a document, built in ONE `doc.descendants` walk and
 * cached per doc (see {@link indexCache}). Scope follows {@link carriesNodeId}:
 * the `doc` root (never visited by `descendants`) and `text` leaves are out;
 * everything else is expected to carry a uid. Unstamped values — `null`, `''`,
 * non-strings — are skipped rather than indexed: they mean "no identity yet",
 * and indexing them would invent collisions between unrelated broken nodes.
 */
export function nodeIdIndex(doc: PMNode): NodeIdIndex {
  const cached = indexCache.get(doc)
  if (cached) return cached

  const byId = new Map<string, NodeIdEntry>()
  const duplicated = new Set<string>()
  doc.descendants((node, pos) => {
    if (!carriesNodeId(node.type.name)) return
    const uid = node.attrs[NODE_ID_ATTRIBUTE] as unknown
    if (typeof uid !== 'string' || uid === '') return
    if (byId.has(uid)) duplicated.add(uid)
    else byId.set(uid, { pos, node })
  })

  const index: NodeIdIndex = { byId, duplicated }
  indexCache.set(doc, index)
  return index
}
