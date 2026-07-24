import type { CSSProperties, ReactNode } from 'react'
import {
  BoldFeature,
  CalloutFeature,
  ColorFeature,
  CommentsFeature,
  CodeBlockFeature,
  ConditionalBlockFeature,
  DividerFeature,
  DocumentVariablesProvider,
  HeaderFooterFeature,
  HeadingFeature,
  HistoryFeature,
  ImageFeature,
  ItalicFeature,
  LinkFeature,
  ListsFeature,
  VariableFeature,
  QuoteFeature,
  TableFeature,
  type ConditionFlag,
  type DocumentVariable,
} from '../features'
import type { DocumentJSON } from '../editor'

/** Every feature the SDK ships, opted in. (Lives here, NOT in a .stories file:
 *  Storybook treats every named export of a stories module as a story.) */
export const ALL_FEATURES = [
  HistoryFeature,
  BoldFeature,
  ItalicFeature,
  HeadingFeature,
  ListsFeature,
  LinkFeature,
  ColorFeature,
  CalloutFeature,
  TableFeature,
  QuoteFeature,
  CodeBlockFeature,
  DividerFeature,
  ImageFeature,
  VariableFeature,
  ConditionalBlockFeature,
  HeaderFooterFeature,
  CommentsFeature,
]

/** Sample consumer variables — the @ menu, chips and conditions read these. */
export const VARIABLES: DocumentVariable[] = [
  { id: 'client.name', label: 'Client name', group: 'Client details' },
  { id: 'client.taxId', label: 'Tax ID', group: 'Client details' },
  { id: 'contract.number', label: 'Contract number', group: 'Contract details' },
  { id: 'contract.term', label: 'Term', group: 'Contract details' },
  { id: 'amount.monthly', label: 'Monthly amount', group: 'Contract details' },
]

/** Sample backend decision catalog — boolean flags the provider scopes to the
 *  conditional-block builder (they never show in the @ picker). */
export const CONDITION_FLAGS: ConditionFlag[] = [
  { id: 'EC_DECISION_FULLTIME', label: 'If contract is full-time' },
  { id: 'EC_DECISION_HAS_PROBATION', label: 'If there is probation period' },
]

/**
 * The documented mount recipe: a sized flex parent (the editor as flex: 1
 * comes from the shell CSS below) + the consumer-owned variables context.
 * Every story renders inside this — exactly what a real consumer does.
 */
export function Shell({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Roboto', system-ui, sans-serif",
        ...style,
      }}
    >
      <style>{`
        body { margin: 0; }
        .sb-shell-grow > .document-editor { flex: 1 0 auto; }
      `}</style>
      <div className="sb-shell-grow" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <DocumentVariablesProvider variables={VARIABLES} conditions={CONDITION_FLAGS}>
          {children}
        </DocumentVariablesProvider>
      </div>
    </div>
  )
}

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

/** Starter content for stories with a REDUCED feature set: PARAGRAPHS ONLY —
 *  the one shape the kernel guarantees. Even a heading or a bold mark is
 *  opt-in, and loading content whose feature is disabled THROWS by design
 *  (the SDK never silently wipes a document). */
export const BASIC_DOC: DocumentJSON = {
  doc: {
    type: 'doc',
    content: [
      paragraph('Service agreement'),
      paragraph('This document is rendered by the SDK with the feature set this story opts into.'),
      paragraph('Select any text to see the bubble toolbar.'),
    ],
  },
}

/** A small starter document so stories don't open on a blank page. */
export const STARTER_DOC: DocumentJSON = {
  doc: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Service agreement' }] },
      paragraph('This document is rendered by the SDK with the feature set each story opts into.'),
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'It supports inline variables like ' },
          { type: 'variable', attrs: { id: 'client.name', label: 'Client name' } },
          { type: 'text', text: ' — type @ to insert one, or / for blocks.' },
        ],
      },
      paragraph('Select any text to see the bubble toolbar.'),
    ],
  },
}

/** Content under review (for the comments stories) — the comment's ANCHOR
 *  lives in the doc as a `comment` mark on "30 days"; its CONTENT (text,
 *  author) lives backend-side, seeded by the stories' fake adapter under the
 *  same id. */
export const COMMENTED_DOC: DocumentJSON = {
  doc: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Review me' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'The delivery deadline is ' },
          {
            type: 'text',
            marks: [{ type: 'comment', attrs: { commentId: 'c-1' } }],
            text: '30 days',
          },
          { type: 'text', text: ' after signature.' },
        ],
      },
    ],
  },
}
