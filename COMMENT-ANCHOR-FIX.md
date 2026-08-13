# Comment anchors across cut/paste — the corruption, six defects, and what shipped

> Upstream's response to the deel-ui report (DOC-4580) and its two companion
> documents: the fix plan ("comment anchors lost across a cut/paste") and the
> implementation write-up ("Anchor fixes to port"). Everything below was
> verified against THIS repository before any code changed; where the
> documents and our tree disagreed, the tree won. deel-ui's vendored copy
> splits `comments.ts` into eight modules — the mechanics are the same, so
> every finding here maps back, and the "port back" notes flag the places
> where the port must differ from what deel-ui shipped first.

## 1. The reported bug

A comment anchored across three paragraphs, after **cut → autosave →
(editor remount, caused by a consumer-side polling bug) → paste →
autosave**, ends up anchored to unrelated text — and the corrupted anchor is
**persisted**. From the network trace, version by version:

| step | what happened |
| --- | --- |
| v6-7 | comment spans 3 paragraphs, anchor `{0,11},{0,9},{0,8}` — splits tracked correctly |
| v8 | **cut** — the edit payload ships **no** `comments` key, so the backend keeps the pre-cut 3-node anchor (defect A) |
| v9 | identical re-save = the remount; the plugin re-seeds from the now-stale record against the post-cut doc; the surviving paragraph holds different text and `resolveSegment` clamps `{0,8}` over it → a live ghost range (defect C); collapse snapshots and the cut-carry buffer died with the plugin instance |
| v10 | **paste** — only the middle uid reappears and revives; the reporter ships the ghost `[{648a…,0,8},{7907…,0,9}]`, permanently rewriting the row |

The uid asymmetry on paste (head loses its uid, middle keeps it, tail
collides with the survivor and is re-minted) is `replaceThreeWay` plus the
NodeIds collision rule working as designed — not part of the bug.

The backend is not at fault: it stores what it is sent.

## 2. The six defects — all confirmed in this tree

The deel-ui plan named A, B and C. Investigating the port write-up's claims
against this tree confirmed three more (A′, A″, D) plus an independent
revival killer (E). All six were real here; all but C are fixed.

**A — a fully-collapsed comment was never reported.** Six suppression gates,
not the four the plan listed: `derivePayload` returning null for zero live
entries; the sweep un-dirtying null payloads; `collect` filtering them;
`confirm` skipping them; *plus* — (5) `confirm` records `lastReported`
before its skip (so the plan's dedupe concern was already covered upstream),
and (6) the bridge population filter `(nodes?.length ?? 0) > 0`, which made
a row already detached on the backend permanently untrackable. The
documented rationale ("writing `nodes: []` would destroy the revival seed")
was mostly wrong — in-session revival reads plugin state, never the stored
record — but not entirely: cross-session paste-back revival genuinely dies
with the detach write. We ship the erasure anyway, deliberately (see the
product rules), and the docblock now owns that cost instead of denying it.

**A′ — "nothing live" is not "the anchor is dead".** A one-transaction
delete+reinsert collapses every live range through the mapping while the
text lands intact under the same uid (the kernel re-mints only when the
landed doc holds a duplicate — a same-transaction move never does; pinned in
`nodeIdsExtension.test.ts`). A naive "known but orphaned → erase" would
destroy valid anchors wholesale: in this SDK the header/footer region
normalizer rewrites the entire document in one transaction and tombstones
EVERY comment at once, and table `mergeCells` does the same for merged-away
cells. This is why the erasure is gated on proof (section 3).

**A″ — the erasure evicts its own revival seed.** Once a detach write
round-trips and the records refresh, the old bridge filter dropped the
`nodes: []` row; the membership reconcile then evicted the tombstone from
both plugin maps, and neither a paste nor an undo could revive the comment.
With a 1500 ms save debounce, "cut, pause, paste" crossed this routinely —
the flow works today only *because* of defect A. Fix: every OPEN, undeleted
row stays in the population; an empty row seeds zero entries (orphan card,
nothing painted) but its membership keeps the tombstone alive.

**B — cut-carry could bind a range to the wrong node.** `applyCutCarry`
text-matched a pasted block, discarded the `pos` it already held, and
re-resolved the uid through `nodeIdIndex.byId` — which keeps the FIRST
occurrence in document order. During a paste the plugin structurally
observes the duplicate-uid window (comments runs in `state.apply`; the
re-mint is an `appendTransaction`), so the lookup could land on the
surviving remainder and mint a live ghost the reporter then persisted. The
existing multi-block test passed by accident: its surviving shell was empty,
so the wrong resolve clamped to nothing.

**D — drag-and-drop orphaned the comment.** A drag-move is ONE transaction
(delete + insert, `uiEvent: 'drop'`), and the carry buffer was recorded only
on `uiEvent: 'cut'` — so cut+paste re-anchored while an identical drag
orphaned. Fixed by recording the buffer inline on a drop that demonstrably
deleted its own dragged selection (the same wiped pair the mapping uses),
which excludes external drops and alt-drag copies, and by never passing a
null buffer to `noteCut` (it assigns unconditionally and would clobber a cut
still waiting for its paste). Covers subrange drags too — the guard is the
deleted selection, never "the comment fully collapsed".

**E — `dormantText` and the revival gates disagreed on normalization.** The
collapse snapshot is produced in the QUOTE norm (inline atoms and hardBreak
quote nothing) while all three revival gates compared a
`LEAF_PLACEHOLDER`-normed derivation (atoms count one space). For any
commented range containing a chip the two strings differ by one space per
leaf and can never match — cut a chip range, put it back, the highlight
stayed dead forever (partially masked for clipboard gestures by the carry,
fully broken for undo and programmatic re-insertion). A fourth mismatched
pair had the same root: the geometry-preserving quote-drift detector
compared placeholder-normed text while protecting the free-normed shipped
quote.

## 3. The detach rule that shipped (fix A + A′ together)

The reporter's ledger derivation (`reportPayloadOf`) adjudicates every dirty
id three ways:

1. any live range → the live payload (mixed rows stay live-only; dormants
   never travel — unchanged);
2. **proven dead** → the detach write `{ nodes: [], quote: '' }`: the id is
   still in storage, its entries sit in `comments` or `dropped`, EVERY entry
   carries a collapse snapshot, and NONE of their stored addresses still
   resolves to it (quote norm, the same derivation that produced the
   snapshot — after fix E there is exactly one norm on both sides);
3. everything else → silence: unknown ids; no entries in either map
   (teardown, pre-seed); any snapshotless entry (a seeded dormant — a
   drifted local doc must not erase a row that may be true for the saved
   one); any entry still resolving to its snapshot (a one-transaction move —
   the stored row is still true).

`payloadFor` — the public seam queued creates ride — deliberately keeps the
live-only derivation: the doomed-create check reads its truthiness, and an
orphan payload is truthy, which would ship a comment anchored to nothing
instead of cancelling it with the user-visible error. For the same reason
the provider now filters queued-create tempIds out of the envelope's
`anchors[]`: an anchor report is a row update and a tempId has no row (this
also closes a pre-existing leak where a drifted queued create shipped a
phantom anchor).

## 4. Where we diverged from the deel-ui documents

Port these back — deel-ui shipped some of them differently.

1. **Fix B keeps the `duplicated` defer the write-up advised against.** The
   stated risk (exhausting the 4-apply retry window) does not hold here: the
   re-mint is the FIRST appended doc-changing transaction in plugin order
   (TipTap collects plugins in reverse registration order and NodeIds
   registers last); the worst adversarial stack consumes 3 of 4 units. The
   bind-immediately variant leaves a transiently wrong `stored.id`, and in
   this tree that is not inert: the `alreadyThere` dedupe compares stored
   triples, so a repeat paste that replaces the survivor loses its carry
   PERMANENTLY; the retry double-adds and the coalesce keeps the stale id;
   the stored-uid-death check cannot see it; and a later boundary-graze
   collapse freezes it into a gate-less revival seed. Shipped: positional
   bind AND a per-node skip on `index.duplicated` (the window retry binds
   one apply later with the settled unique uid).
2. **Fix E goes through the gates, not the snapshot.** Re-norming
   `dormantText` production hits the trap the write-up itself flags (the
   remapped gate derives from the node the revival is moving *away* from).
   Deleting `LEAF_PLACEHOLDER` from the three gate comparisons is
   equivalent and trap-free — each gate derives from its own already-resolved
   range, and the golden vectors pin the quote norm as the FE/BE contract.
   The quote-drift detector moved to the same norm.
3. **The plan's fix A was incomplete for a real tree.** As written it lacked
   the A′ proof gate (mass erasure via the normalizer/mergeCells shapes) and
   A″ (the revival regression after a detach round-trip). Both are
   mandatory, not hardening.
4. **`quote: ''` on a detach must not blank the stored quote.** The orphan
   card renders the row's stored quote as its context line. The incoming
   `''` is the anchor checksum (the honest quote of zero segments — it is
   also what makes the write validate: `quoteOf(doc, []) === ''`). Backends
   should clear `nodes` and KEEP the last quote on a detach; the demo mock
   now models exactly that.
5. **Defect C stays deferred, with one correction to the plan's rationale.**
   "A quote gate cannot fire" is true of the documents service, not of the
   SDK: records here carry a quote end-to-end. We adopted the write-up's
   per-segment design (`{ id, from, to, quote }`, presence-gated; a refused
   segment keeps its quote as `dormantText`, which also closes the
   snapshotless-reappearance hole) as the follow-up, in its own cycle — it
   changes the shared FE/BE contract, the golden vectors and dozens of shape
   assertions, and none of it protects anything until a backend stores the
   quotes. Known residue until then: an in-app remount between a cut and its
   detach-confirm can still seed the stale client-side record; a silenced
   move-tombstone whose text is edited later never detaches (stale but
   harmless, exactly as today).

## 5. Product rules (confirmed with the owner)

- **Deleting commented text orphans the comment — forever.** Plain delete,
  type-over, paste-over: the detach persists; retyping the same characters
  never revives; cross-session paste-back revival is deliberately forfeited
  (the orphan card keeps the thread, its quote and replies).
- **Cut+paste and drag-and-drop are MOVES** — the comment follows the text.
  In-session revival (tombstones, carry, undo) is untouched, and when an
  autosave lands mid-move the row simply tracks the screen: a detach write,
  then the healing write.

## 6. Backend changes — what is needed, and what could break

Nothing server-side is required for THIS fix to ship; everything below is
either an adapter concern, additive, or gated to stay inert until adopted.

**Now (to consume the fix):**

1. *Accept the cleared anchor.* The SDK emits the detach as `nodes: []`;
   your adapter translates to the documents service's `nodes: null`. The
   service must accept clearing an existing comment's anchor on the edit
   endpoint — per your own plan it already does. If any validator requires
   at least one segment, relax it for updates.
2. *Audit consumers of the rows.* Anything that assumes `nodes` is non-empty
   — list rendering, jump-to-comment, PDF/export pipelines resolving
   highlights — must tolerate a detached row (render the orphan card, skip
   the highlight; never crash or filter the thread away). This is the
   server-side twin of fix A″: your vendored `commentsLayer` carries the
   same `nodes.length > 0` population filter and must keep detached rows
   tracked, or the detach round-trip kills in-session revival.

**Recommended (when a quote is stored):**

3. *Detach keeps the last quote.* On a `nodes: []`/`null` write, clear the
   anchor but preserve the stored quote — it is the orphan card's context
   line, and the incoming `''` is the checksum of zero segments, not display
   copy. Inapplicable today (the documents service stores no quote); the
   demo mock models it as the reference behavior.

**For defect C (its own cycle):**

4. *Store and echo a per-segment quote* — `{ id, from, to, quote }`. Pure
   storage: no server-side logic, the validation runs client-side at seed
   time. The SDK's gate is presence-gated, so this cannot break anything by
   construction: rows without per-segment quotes (all existing data) resolve
   exactly as today — no migration, no flag day, old SDK versions ignore the
   unknown field. If the service ever validates quotes itself, it must use
   the shared offset norm pinned by `commentAnchor.golden.ts` (text 1:1,
   inline atoms and hardBreak occupy 1 position and quote nothing) — any
   other norm would false-reject legitimate writes.

The one behavior change visible to other scenarios is intentional: a comment
whose text was deleted now *looks* detached everywhere (row, exports, other
sessions) instead of silently pointing at text that no longer exists. A
detached row is also structurally identical to a "document-level comment"
(`nodes: []` was already legal §9.3) — if your product uses those, the
orphan card is exactly how both should render.

## 7. What shipped, and how it is verified

Source: `comments.ts` (the detach rule, the positional+deferred carry, the
three gate one-liners, the drift detector, drop-carry recording),
`commentsLayer.tsx` (population keeps empty rows), `commentsProvider.tsx`
(tempId filter), `commentsMock.ts` (detach keeps the stored quote),
`ARCHITECTURE.md` + Storybook copy.

Tests — 698 passing, of which this change flipped four deliberate pins and
added fourteen: the detach write (collect → confirm → no re-send), the
one-transaction-move silence, the unresolvable-segment hold, the reported
three-block both-edges-partial gesture, the duplicate-uid window (binds the
pasted copy, never the survivor), drag-move carries (whole and subrange),
the external-drop guard, detach round-trip revival via paste AND via undo,
the fresh-session orphan limit, the chip-range revival, the tempId leak, the
mock's detach-keeps-quote rule, and a real-feature integration of the
header/footer normalizer (tombstones everything, ships nothing, reload
restores). Every bug-pinning test was run against the pre-fix tree and
confirmed to FAIL there (revert-and-check).

Verified live in the browser against the Storybook rig (real 1500 ms
autosave + mock latency): the cut shipped the detach (`nodes: []`, quote
preserved, orphan card with "Original text was removed"), pasting unrelated
content revived nothing, and undo restored the highlight with the next save
healing the row back to its original segments.
