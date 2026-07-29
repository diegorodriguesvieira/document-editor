import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { DocumentEditor } from '../editor'
import { ALL_FEATURES, Shell, VARIABLES } from './storyShell'
import type { DocumentJSON } from '../editor'

const meta = {
  title: 'Editor/10. Read-only',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          '`editable={false}` puts the editor in READ-ONLY mode: the document renders with its ' +
          'full layout but rejects typing, and every SDK surface that mutates content hides ' +
          'itself — the insert dock, page-region affordances, the context menu and the ' +
          'node-view controls. The **conditional block** keeps its summary bar (reading) and ' +
          'the collapse chevron, but drops the ⊕ nest / 🗑 delete buttons and never opens the ' +
          'condition editor. This also holds for a DIRECT `editor.setEditable(false)` call ' +
          '(outside the React prop): the engine dispatches a re-render nudge, and every ' +
          'mutating handler re-checks `isEditable` at call time.',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

/** A doc centered on conditional blocks — one complete condition, one nested. */
const CONDITIONAL_DOC: DocumentJSON = {
  doc: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Conditional clauses' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'The blocks below render only when their condition holds.' }],
      },
      {
        type: 'conditionalBlock',
        attrs: {
          condition: {
            all: [
              {
                op: 'GREATER_THAN',
                params: [
                  { type: 'variable', ref: 'amount.monthly' },
                  { type: 'literal', value: 10000 },
                ],
              },
            ],
          },
        },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'A dedicated account manager is assigned to this contract.' }],
          },
          {
            type: 'conditionalBlock',
            attrs: {
              condition: {
                all: [
                  {
                    op: 'EQUALS',
                    params: [
                      { type: 'variable', ref: 'contract.term' },
                      { type: 'literal', value: 12 },
                    ],
                  },
                ],
              },
            },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Annual pricing lock applies for the full term.' }],
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Regular content stays selectable for copying either way.' }],
      },
    ],
  },
}

export const ReadOnly: Story = {
  name: 'Read-only (editable={false})',
  render: () => (
    <Shell>
      <DocumentEditor features={ALL_FEATURES} content={CONDITIONAL_DOC} editable={false} />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The locked presentation: conditional bars read as summaries (variables resolve to ' +
          `their labels — ${VARIABLES.length} provided by the story shell), the collapse chevron still works ` +
          'on the grouped block, and clicking "Show if" does nothing. No ⊕/🗑, no insert dock, ' +
          'no typing.',
      },
    },
  },
}

/** The app's preview/edit recipe: the `editable` prop toggled live. */
function ToggleStory() {
  const [preview, setPreview] = useState(true)
  return (
    <Shell>
      <DocumentEditor
        features={ALL_FEATURES}
        content={CONDITIONAL_DOC}
        editable={!preview}
        renderHeader={() => (
          <>
            <strong style={{ fontSize: 15 }}>Conditional clauses.pdf</strong>
            <button
              type="button"
              aria-pressed={preview}
              style={{
                height: 32,
                padding: '0 14px',
                border: '1px solid #dadce0',
                borderRadius: 8,
                background: '#fff',
                cursor: 'pointer',
              }}
              onClick={() => setPreview((current) => !current)}
            >
              {preview ? 'Edit' : 'Preview'}
            </button>
          </>
        )}
      />
    </Shell>
  )
}

export const PreviewToggle: Story = {
  name: 'Live preview/edit toggle',
  render: () => <ToggleStory />,
  parameters: {
    docs: {
      description: {
        story:
          'Flipping `editable` live does NOT recreate the editor (undo/scroll survive). Open a ' +
          'condition editor in Edit, hit Preview: the panel CLOSES (and does not resurrect when ' +
          'you come back), the ⊕/🗑 controls drop, and the summary goes inert.',
      },
    },
  },
}
