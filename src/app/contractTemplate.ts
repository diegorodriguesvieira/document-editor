import type { EditorApi } from '../editor'

type DocJSON = Parameters<EditorApi['setJSON']>[0]
/** Structural slice of the editor we need — keeps the app off @tiptap/* imports. */
type SchemaSource = { schema: { nodes: Record<string, unknown> } }
type Node = Record<string, unknown>

const text = (value: string): Node => ({ type: 'text', text: value })
const paragraph = (...content: Node[]): Node => ({
  type: 'paragraph',
  ...(content.length ? { content } : {}),
})
const heading = (level: number, value: string): Node => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
})

/** A tiny inline-SVG "logo" so the image block needs no network. */
const LOGO_SRC =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="96">
      <rect width="480" height="96" rx="10" fill="#1b1b1b"/>
      <circle cx="52" cy="48" r="22" fill="#8ab4f8"/>
      <text x="96" y="58" font-family="Arial" font-size="30" font-weight="bold" fill="#fff">ACME Services Ltd.</text>
    </svg>`,
  )

/**
 * The demo's "start from a template" document — a service agreement using
 * every rich block the ACTIVE preset offers. Built against the SCHEMA (which
 * nodes the enabled features registered — NOT `api.hasNode`, which asks the
 * current document) so it degrades gracefully: on a minimal preset the same
 * call produces just headings and paragraphs (the SDK's content check rejects
 * unknown nodes by design, so a template must ask the schema, not assume it).
 */
export function contractTemplate(editor: SchemaSource): DocJSON {
  const has = (name: string) => Boolean(editor.schema.nodes[name])
  // Merge fields degrade to visible {placeholders} on presets without them.
  const field = (id: string, label: string): Node =>
    has('mergeField') ? { type: 'mergeField', attrs: { id, label } } : text(`{${label}}`)

  const cell = (kind: 'tableHeader' | 'tableCell', ...content: Node[]): Node => ({
    type: kind,
    content: [paragraph(...content)],
  })
  const row = (label: string, value: Node): Node => ({
    type: 'tableRow',
    content: [cell('tableCell', text(label)), cell('tableCell', value)],
  })

  const content: Node[] = []

  if (has('documentHeader')) {
    content.push({
      type: 'documentHeader',
      content: [paragraph(text('ACME Services Ltd. — Confidential · Contract '), field('contrato.numero', 'Contract number'))],
    })
  }

  if (has('image')) content.push({ type: 'image', attrs: { src: LOGO_SRC, alt: 'ACME logo' } })

  content.push(
    heading(1, 'Service agreement'),
    paragraph(
      text('This agreement is made between ACME Services Ltd. and '),
      field('cliente.nome', 'Client name'),
      text(', tax ID '),
      field('cliente.cnpj', 'Tax ID'),
      text(', under contract '),
      field('contrato.numero', 'Contract number'),
      text('.'),
    ),
    heading(2, 'Parties & terms'),
  )

  if (has('table')) {
    content.push({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [cell('tableHeader', text('Item')), cell('tableHeader', text('Detail'))],
        },
        row('Client', field('cliente.nome', 'Client name')),
        row('Term (months)', field('contrato.vigencia', 'Term')),
        row('Monthly amount', field('valor.mensal', 'Monthly amount')),
      ],
    })
  } else {
    content.push(
      paragraph(text('Client: '), field('cliente.nome', 'Client name')),
      paragraph(text('Term (months): '), field('contrato.vigencia', 'Term')),
      paragraph(text('Monthly amount: '), field('valor.mensal', 'Monthly amount')),
    )
  }

  if (has('bulletList')) {
    content.push(heading(2, 'Deliverables'), {
      type: 'bulletList',
      content: [
        'Monthly progress report',
        'Dedicated support channel',
        'Quarterly business review',
      ].map((item) => ({ type: 'listItem', content: [paragraph(text(item))] })),
    })
  }

  if (has('conditionalBlock')) {
    content.push(
      heading(2, 'Conditional clauses'),
      {
        type: 'conditionalBlock',
        attrs: { variable: 'valor.mensal', condition: 'GREATER_THAN', value: '10000' },
        content: [
          paragraph(text('A dedicated account manager is assigned to this contract.')),
          {
            // Nested block = AND: monthly > 10k AND term = 12.
            type: 'conditionalBlock',
            attrs: { variable: 'contrato.vigencia', condition: 'EQUALS', value: '12' },
            content: [paragraph(text('Annual pricing lock applies for the full term.'))],
          },
        ],
      },
    )
  }

  if (has('callout')) {
    content.push({
      type: 'callout',
      attrs: { emoji: '💡' },
      content: [
        paragraph(text('Fill in the merge fields via @ — values resolve when the PDF is generated.')),
      ],
    })
  }

  if (has('blockquote')) {
    content.push({
      type: 'blockquote',
      content: [paragraph(text('“Signed electronically by both parties on the date of last signature.”'))],
    })
  }

  if (has('documentFooter')) {
    content.push({
      type: 'documentFooter',
      content: [paragraph(text('ACME Services Ltd. · Contract '), field('contrato.numero', 'Contract number'))],
    })
  }

  return { doc: { type: 'doc', content } } as DocJSON
}
