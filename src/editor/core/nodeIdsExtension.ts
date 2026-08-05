import {
  combineTransactionSteps,
  Extension,
  findChildrenInRange,
  getChangedRanges,
} from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Mapping } from '@tiptap/pm/transform'
import { nodeIdIndex } from './nodeIdIndex'
import { NODE_ID_ATTRIBUTE, generateNodeId } from './nodeIds'

export interface NodeIdsOptions {
  /** Node type names in id scope — every schema node except `doc` and `text`.
   *  buildExtensions enumerates this from the resolved extension list; the
   *  attribute NAME is not an option because `uid` is the fixed contract
   *  (NODE_ID_ATTRIBUTE), shared with the entry-injection helpers. */
  types: string[]
}

/** Meta key of the remap record a collision re-mint sets on its appended
 *  transaction. Consumers that mirror per-node data (the comments copy-extend)
 *  watch for it to learn "this new node is a copy of that one". */
export const UID_REMAPPED_META = 'uidRemapped'

/** The {@link UID_REMAPPED_META} payload: NEW uid → SOURCE uid. Keyed on the
 *  new side because fresh ids are unique by construction, while one source can
 *  be duplicated twice in a single paste — two entries sharing a value. */
export type UidRemapMeta = Map<string, string>

/** Whether any node OTHER than the one at `pos` currently holds `uid` and
 *  SURVIVES from the pre-batch doc (its position maps back through the
 *  inverted batch mapping instead of landing in inserted content). Such a
 *  survivor is the id's rightful owner — the copy must re-mint, wherever it
 *  landed. Rare path: only reached when a genuine collision candidate is also
 *  the first occurrence in document order. */
function hasSurvivingHolder(doc: PMNode, uid: string, pos: number, inverted: Mapping): boolean {
  let found = false
  doc.descendants((node, nodePos) => {
    if (found) return false
    if (
      nodePos !== pos &&
      node.attrs[NODE_ID_ATTRIBUTE] === uid &&
      !inverted.mapResult(nodePos).deleted
    ) {
      found = true
    }
    return !found
  })
  return found
}

/**
 * The uid kernel extension — replaces `@tiptap/extension-unique-id` with the
 * decided identity semantics (see the comments plan, decision 5): a node's id
 * SURVIVES moving and is re-minted only on real duplication.
 *
 * Division of labour: entry injection (`injectNodeIds`, run by every entry
 * point) guarantees documents are id-complete when they reach the editor, so
 * this extension has NO create-scan and never backfills a load. It owns
 * everything born after entry through ONE appendTransaction — no
 * `transformPasted`, no DOM event handlers, no window listeners (the stock
 * extension needs all three only because it re-mints EVERY pasted node and
 * must guess intent from clipboard events). Here intent is read off the
 * resulting document instead:
 *
 * - MOVE (drag-move, cut+paste): the delete — same transaction or an earlier
 *   one — removed the other holder, so the landed doc has the uid once, there
 *   is no collision, and the id survives. Anything keyed on uid (a comment
 *   anchor) survives a move with zero bookkeeping.
 * - COPY (paste while the source is still present): the source survives, the
 *   copy collides, the copy re-mints — and the appended transaction carries
 *   {@link UID_REMAPPED_META} so consumers can extend per-node data onto the
 *   copy. The same rule heals a colliding programmatic `insertContent`.
 */
export const NodeIds = Extension.create<NodeIdsOptions>({
  name: 'nodeIds',

  addOptions() {
    return { types: [] }
  },

  addGlobalAttributes() {
    // Same declaration shape as the stock extension this replaces: `null` is
    // the "unstamped" sentinel appendTransaction fills, the value round-trips
    // through `data-uid` (the backend contract marker), and renderHTML omits
    // the attribute entirely while unset so no `data-uid="null"` ever leaks.
    return [
      {
        types: this.options.types,
        attributes: {
          [NODE_ID_ATTRIBUTE]: {
            default: null,
            parseHTML: (element) => element.getAttribute(`data-${NODE_ID_ATTRIBUTE}`),
            renderHTML: (attributes) => {
              if (!attributes[NODE_ID_ATTRIBUTE]) {
                return {}
              }
              return { [`data-${NODE_ID_ATTRIBUTE}`]: attributes[NODE_ID_ATTRIBUTE] }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    const scope = new Set(this.options.types)

    return [
      new Plugin({
        key: new PluginKey('nodeIds'),
        appendTransaction: (transactions, oldState, newState) => {
          // Only doc changes can mint ids (stock guard, both halves needed:
          // `docChanged` alone also fires for batches that cancel out, and a
          // doc-equal batch must not append — the setEditable nudge and the
          // read-only contracts pin "no phantom transactions").
          const hasDocChanges =
            transactions.some((transaction) => transaction.docChanged) &&
            !oldState.doc.eq(newState.doc)
          if (!hasDocChanges) return

          // COLLAB GUARD (future Yjs): remote CRDT transactions arrive tagged
          // `y-sync$` already carrying the ids their author minted — remote
          // clients own their own ids. Re-minting over them would fork
          // identity between replicas; local edits still flow through here
          // untagged, so the fill path stays complete under collaboration.
          if (transactions.some((transaction) => transaction.getMeta('y-sync$'))) return

          const { tr } = newState
          const transform = combineTransactionSteps(oldState.doc, [...transactions])
          const inverted = transform.mapping.invert()
          const changes = getChangedRanges(transform)
          // Collision pre-filter over the landed doc (immutable → the WeakMap
          // makes this the one full walk of the common path). Every fix below
          // only ever REDUCES a uid's occurrence count, so a uid unique here
          // can never need a re-mint — plain typing exits on this set alone.
          const landed = nodeIdIndex(newState.doc)
          // Occurrence counts, decremented as fixes land — the collision
          // re-check without re-indexing the doc per re-mint (attribute-only
          // rewrites keep every position stable, so `landed` positions stay
          // valid throughout). Built only when the landed doc actually holds
          // duplicates; plain typing never pays for it.
          const counts = new Map<string, number>()
          if (landed.duplicated.size > 0) {
            newState.doc.descendants((node) => {
              const uid = node.attrs[NODE_ID_ATTRIBUTE] as unknown
              if (typeof uid === 'string' && uid !== '') {
                counts.set(uid, (counts.get(uid) ?? 0) + 1)
              }
            })
          }
          const remapped: UidRemapMeta = new Map()

          // POSITION INVARIANT the whole pass leans on: every step below is a
          // setNodeMarkup keeping the node's type — an attribute-only rewrite
          // that changes no sizes — so positions taken from newState.doc stay
          // valid in tr.doc throughout, and indexes of the two stay comparable.
          for (const { newRange } of changes) {
            const children = findChildrenInRange(newState.doc, newRange, (node) =>
              scope.has(node.type.name),
            )
            children.forEach(({ node, pos }, index) => {
              // Read through tr.doc: an earlier iteration may have rewritten
              // this node's uid already (the split transfer does exactly that).
              const live = tr.doc.nodeAt(pos)
              if (!live) return
              const uid = live.attrs[NODE_ID_ATTRIBUTE] as unknown

              // FILL: born without an id → mint. `''`/non-string garbage
              // counts as missing, mirroring injectNodeIds at entry.
              if (typeof uid !== 'string' || uid === '') {
                tr.setNodeMarkup(pos, undefined, {
                  ...live.attrs,
                  [NODE_ID_ATTRIBUTE]: generateNodeId(),
                })
                return
              }

              // EMPTY-FIRST-HALF SPLIT: Enter at the START of a textblock
              // yields an EMPTY first half and a content-bearing second half,
              // BOTH carrying the original uid (split copies attrs). Identity
              // must follow the CONTENT, so the empty shell re-mints and the
              // second half keeps `uid` untouched. STRICTLY that shape:
              // an empty TEXTBLOCK whose in-range successor carries the SAME
              // uid. Leaves/atoms have content.size 0 too but never split,
              // and a pasted empty block sitting next to a foreign uid is a
              // collision candidate like any other — every non-split shape
              // FALLS THROUGH to the collision rule below (an early return
              // here once let pasted empty blocks keep a colliding uid
              // forever — pinned in nodeIdsExtension.test.ts).
              const next = children[index + 1]
              if (next && node.isTextblock && node.content.size === 0) {
                const nextLive = tr.doc.nodeAt(next.pos)
                if (nextLive && nextLive.attrs[NODE_ID_ATTRIBUTE] === uid) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...live.attrs,
                    [NODE_ID_ATTRIBUTE]: generateNodeId(),
                  })
                  counts.set(uid, (counts.get(uid) ?? 1) - 1)
                  return
                }
              }

              // COLLISION RE-MINT — the decided semantics. Candidates are
              // nodes NEW in this batch: their position sits inside content
              // the steps inserted, so the inverse mapping reports it deleted
              // (as stock does). Old survivors are never touched.
              if (!inverted.mapResult(pos).deleted) return
              // Live re-check via the occurrence counts — earlier fixes (the
              // split transfer, a prior re-mint) decrement, so an already
              // resolved uid exits here without re-indexing the doc.
              if ((counts.get(uid) ?? 0) < 2) return
              // Retention: the SOURCE keeps its id. If any other holder
              // survives from the old doc, that survivor is the source and
              // this newborn re-mints wherever it landed — document order
              // alone would let a copy pasted ABOVE its source steal the id
              // and leave the doc duplicated. Only when every holder is
              // newborn (one insert carrying an internal duplicate) does
              // first-in-document-order win, matching injectNodeIds at entry.
              // (`landed` positions remain valid — every fix so far was an
              // attribute-only rewrite.)
              const retained =
                landed.byId.get(uid)?.pos === pos &&
                !hasSurvivingHolder(tr.doc, uid, pos, inverted)
              if (retained) return
              const fresh = generateNodeId()
              tr.setNodeMarkup(pos, undefined, {
                ...live.attrs,
                [NODE_ID_ATTRIBUTE]: fresh,
              })
              counts.set(uid, (counts.get(uid) ?? 1) - 1)
              remapped.set(fresh, uid)
            })
          }

          if (!tr.steps.length) {
            return
          }
          // Stock parity: an appended transaction would otherwise wipe marks
          // primed between keystrokes (toggle bold, then type).
          tr.setStoredMarks(newState.tr.storedMarks)
          if (remapped.size > 0) {
            tr.setMeta(UID_REMAPPED_META, remapped)
          }
          return tr
        },
      }),
    ]
  },
})
