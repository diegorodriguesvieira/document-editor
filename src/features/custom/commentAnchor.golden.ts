import type { JSONContent } from '@tiptap/core'
import type { CommentNodeSegment } from './commentAnchor'

/**
 * SHARED FE/BE OFFSET-CONTRACT FIXTURE.
 *
 * These vectors pin the anchor offset norm both sides must agree on (see
 * {@link CommentNodeSegment}): node-local ProseMirror content offsets,
 * 0-based, end-exclusive; text counts one per character; inline atoms
 * (variable chips) and hardBreak count exactly 1 and quote nothing. The
 * backend's quote validator must resolve each `segment` against `doc` and
 * produce exactly `text` — run the SAME vectors there, or FE and BE drift in
 * the counting and the validator manufactures false `STALE_CONTENT` errors.
 *
 * Every uid is explicit so the vectors are deterministic and portable: no
 * editor, no id minting, plain JSON in — string (or null) out.
 */
export interface CommentAnchorGoldenVector {
  name: string
  /** A full document, uids explicit. */
  doc: JSONContent
  segment: CommentNodeSegment
  /** The expected quote. `null` = the segment must NOT resolve (missing uid,
   *  or offsets that collapse under read-side clamping). `''` = it resolves
   *  but covers no text (atom-only spans). */
  text: string | null
}

/** "hello world" in a plain paragraph — content size 11. */
const PLAIN_DOC: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { uid: 'p-plain' },
      content: [{ type: 'text', text: 'hello world' }],
    },
  ],
}

/** "ab {{chip}} cd" — text(3) + atom(1) + text(3), content size 7. */
const CHIP_DOC: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { uid: 'p-chip' },
      content: [
        { type: 'text', text: 'ab ' },
        {
          type: 'variable',
          attrs: { id: 'client.name', label: 'Client name', uid: 'v-chip' },
        },
        { type: 'text', text: ' cd' },
      ],
    },
  ],
}

/** "one<br>two" — text(3) + hardBreak(1) + text(3), content size 7. */
const BREAK_DOC: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { uid: 'p-break' },
      content: [
        { type: 'text', text: 'one' },
        { type: 'hardBreak', attrs: { uid: 'b-break' } },
        { type: 'text', text: 'two' },
      ],
    },
  ],
}

export const COMMENT_ANCHOR_GOLDEN_VECTORS: CommentAnchorGoldenVector[] = [
  {
    name: 'plain text — word at content start',
    doc: PLAIN_DOC,
    segment: { id: 'p-plain', from: 0, to: 5 },
    text: 'hello',
  },
  {
    name: 'plain text — word ending at content end',
    doc: PLAIN_DOC,
    segment: { id: 'p-plain', from: 6, to: 11 },
    text: 'world',
  },
  {
    name: 'full block — offsets 0..content.size',
    doc: PLAIN_DOC,
    segment: { id: 'p-plain', from: 0, to: 11 },
    text: 'hello world',
  },
  {
    name: 'variable chip mid-range counts 1 position and quotes nothing',
    doc: CHIP_DOC,
    segment: { id: 'p-chip', from: 0, to: 7 },
    text: 'ab  cd',
  },
  {
    name: 'atom-only span resolves with an empty quote',
    doc: CHIP_DOC,
    segment: { id: 'p-chip', from: 3, to: 4 },
    text: '',
  },
  {
    name: 'hardBreak counts 1 position and quotes nothing',
    doc: BREAK_DOC,
    segment: { id: 'p-break', from: 0, to: 7 },
    text: 'onetwo',
  },
  {
    name: 'offsets on the far side of a hardBreak',
    doc: BREAK_DOC,
    segment: { id: 'p-break', from: 4, to: 7 },
    text: 'two',
  },
  {
    name: 'overlong `to` clamps to content.size — read-side repair',
    doc: PLAIN_DOC,
    segment: { id: 'p-plain', from: 6, to: 999 },
    text: 'world',
  },
  {
    name: 'offsets fully past the content collapse to null',
    doc: PLAIN_DOC,
    segment: { id: 'p-plain', from: 50, to: 60 },
    text: null,
  },
  {
    name: 'missing uid never resolves',
    doc: PLAIN_DOC,
    segment: { id: 'uid-not-in-doc', from: 0, to: 5 },
    text: null,
  },
]
