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

const chip = (id: string, label: string) => ({ type: 'variable', attrs: { id, label } })
const mixed = (...parts: Array<string | ReturnType<typeof chip>>) => ({
  type: 'paragraph',
  content: parts.map((part) => (typeof part === 'string' ? { type: 'text', text: part } : part)),
})

/** A LONG agreement with variable chips spread far apart — the used-variables
 *  panel story needs real scroll distance between occurrences. Uses 3 of the
 *  5 provider VARIABLES on purpose: the panel lists what the DOCUMENT uses,
 *  not what the @ menu offers. `client.name` appears 3× (opening, clause 9,
 *  signature line) so the occurrence navigator has a cycle worth walking. */
export const VARIABLES_DOC: DocumentJSON = {
  doc: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Service agreement' }] },
      mixed(
        'This agreement is entered into by ',
        chip('client.name', 'Client name'),
        ' ("the Client") and Acme Studio Ltda ("the Provider"), who agree to the terms below.',
      ),
      paragraph('1. Scope. The Provider will deliver the design and development services described in the attached statement of work, including revisions agreed in writing during the engagement.'),
      paragraph('1.1. Any request outside the statement of work is a change request: the Provider estimates it separately and work starts only after the Client approves the estimate.'),
      mixed(
        '2. Fees. The Client shall pay the Provider ',
        chip('amount.monthly', 'Monthly amount'),
        ' per month, due on the fifth business day, against an invoice issued on the first.',
      ),
      paragraph('2.1. Late payments accrue interest of 1% per month plus monetary correction. Work may be suspended after fifteen days of delay, without prejudice to amounts already owed.'),
      paragraph('3. Term. This agreement runs for twelve months from the signature date and renews automatically for equal periods unless either party gives thirty days’ written notice.'),
      paragraph('3.1. Either party may terminate for material breach if the breach is not cured within fifteen days of written notice describing it.'),
      paragraph('4. Confidentiality. Each party will keep the other’s non-public information confidential and use it only to perform this agreement, for as long as the information remains confidential.'),
      paragraph('4.1. Disclosure required by law or court order is not a breach, provided the disclosing party notifies the other promptly and limits the disclosure to what is required.'),
      mixed(
        '5. Registration. This engagement is registered under contract ',
        chip('contract.number', 'Contract number'),
        ', which must be referenced in every invoice, notice and amendment.',
      ),
      paragraph('5.1. Amendments are valid only in writing and signed by both parties. E-mail exchanges do not amend this agreement unless both parties expressly say so.'),
      paragraph('6. Intellectual property. Deliverables become the Client’s property upon full payment. The Provider retains its pre-existing tools, libraries and know-how.'),
      paragraph('6.1. The Provider may reference the project in its portfolio unless the Client objects in writing before final delivery.'),
      paragraph('7. Liability. Each party’s aggregate liability under this agreement is limited to the total fees paid in the twelve months preceding the event that gave rise to the claim.'),
      paragraph('7.1. Neither party is liable for indirect damages, loss of profit or loss of data, except in cases of willful misconduct.'),
      paragraph('8. Data protection. The parties will process personal data only as needed to perform this agreement and in accordance with the applicable data-protection legislation.'),
      mixed(
        '9. Notices. Notices to ',
        chip('client.name', 'Client name'),
        ' shall be sent to the address on file; notices to the Provider, to its registered office. Notice by e-mail counts when receipt is confirmed.',
      ),
      paragraph('10. Governing law. This agreement is governed by Brazilian law. The parties elect the courts of São Paulo, SP, waiving any other venue, however privileged.'),
      mixed(
        'Signed in two counterparts of equal content and form by ',
        chip('client.name', 'Client name'),
        ' and the Provider, in the presence of the witnesses below.',
      ),
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
