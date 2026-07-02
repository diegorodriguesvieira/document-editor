import { describe, expect, it } from 'vitest'
import {
  BoldFeature,
  CalloutFeature,
  CodeBlockFeature,
  ColorFeature,
  CommentsFeature,
  ConditionalBlockFeature,
  DividerFeature,
  HeaderFooterFeature,
  HeadingFeature,
  HistoryFeature,
  ImageFeature,
  ItalicFeature,
  LinkFeature,
  ListsFeature,
  MergeFieldFeature,
  QuoteFeature,
  TableFeature,
} from './index'
import { renderEditor } from '../test/editorHarness'

const ALL_FEATURES = [
  HistoryFeature,
  BoldFeature,
  ItalicFeature,
  LinkFeature,
  ColorFeature,
  HeadingFeature,
  ListsFeature,
  QuoteFeature,
  CodeBlockFeature,
  DividerFeature,
  TableFeature,
  ImageFeature,
  CalloutFeature,
  MergeFieldFeature,
  ConditionalBlockFeature,
  HeaderFooterFeature,
  CommentsFeature,
]

/** One node/mark of every feature, in an order the schema+guards accept. */
const KITCHEN_SINK = {
  doc: {
    type: 'doc',
    content: [
      { type: 'documentHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'header' }] }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'title' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          { type: 'text', text: ' colored', marks: [{ type: 'textStyle', attrs: { color: '#188038' } }] },
          { type: 'text', text: ' noted', marks: [{ type: 'comment', attrs: { commentId: 'c-1' } }] },
          { type: 'mergeField', attrs: { id: 'client.name', label: 'Client name' } },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quote' }] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'code()' }] },
      { type: 'horizontalRule' },
      { type: 'image', attrs: { src: 'https://example.com/pic.png' } },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }] },
            ],
          },
        ],
      },
      { type: 'callout', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note' }] }] },
      {
        type: 'conditionalBlock',
        attrs: { variable: 'pais', condition: 'EQUALS', value: 'brazil' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'gated' }] }],
      },
      { type: 'paragraph' },
      { type: 'documentFooter', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'footer' }] }] },
    ],
  },
}

/**
 * The composition guarantee the SDK sells: every feature enabled TOGETHER, one
 * node/mark of each, loading + serializing without schema conflicts. Guards
 * (header/footer normalization, depth cap, trailing node) may normalize, so
 * fidelity is asserted as a FIXPOINT: a second round-trip changes nothing.
 */
describe('cross-feature composition (kitchen sink)', () => {
  it('loads a document using every feature without throwing (content check is on)', () => {
    const { api } = renderEditor(ALL_FEATURES)
    expect(() => api.setJSON(KITCHEN_SINK)).not.toThrow()
  })

  it('keeps every feature node/mark through the round-trip and reaches a fixpoint', () => {
    const { api } = renderEditor(ALL_FEATURES)
    api.setJSON(KITCHEN_SINK)

    const once = api.getJSON()
    for (const type of [
      'documentHeader',
      'heading',
      'bulletList',
      'blockquote',
      'codeBlock',
      'horizontalRule',
      'image',
      'table',
      'callout',
      'conditionalBlock',
      'mergeField',
      'documentFooter',
    ]) {
      expect(JSON.stringify(once.doc)).toContain(`"type":"${type}"`)
    }

    api.setJSON(once)
    expect(api.getJSON()).toEqual(once) // normalization is a fixpoint, not churn
  })

  it('serializes every backend contract marker into the HTML', () => {
    const { api } = renderEditor(ALL_FEATURES)
    api.setJSON(KITCHEN_SINK)
    const html = api.getHTML()

    for (const marker of [
      'data-document-header',
      'data-document-footer',
      'data-conditional-block',
      'data-variable="pais"',
      'data-merge-field="client.name"',
      'data-comment-id="c-1"',
      'data-type="callout"',
      '<strong', '<em', 'href="https://example.com"',
      '<table', '<img', '<pre', '<blockquote', '<hr', '<ul',
    ]) {
      expect(html).toContain(marker)
    }
    // jsdom normalizes hex → rgb(); accept either so the contract isn't
    // pinned to the DOM implementation.
    expect(html).toMatch(/color: (rgb\(24, 128, 56\)|#188038)/)
  })
})
