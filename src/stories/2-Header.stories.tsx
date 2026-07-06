import type { Meta, StoryObj } from '@storybook/react-vite'
import { DocumentEditor } from '../editor'
import { ALL_FEATURES, Shell, STARTER_DOC } from './storyShell'


const meta = {
  title: 'Editor/2. Header',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The header is an SDK **shell** — a sticky, full-width bar with a fixed height ' +
          '(`--editor-header-height`, 72px). Teams bring the CONTENT via `renderHeader`; ' +
          'returning `null` hides the bar entirely.',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

export const CustomContent: Story = {
  name: 'Custom header content',
  render: () => (
    <Shell>
      <DocumentEditor
        features={ALL_FEATURES}
        content={STARTER_DOC}
        renderHeader={() => (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <strong style={{ fontSize: 16 }}>Service agreement.pdf</strong>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: '#e6f4ea',
                  color: '#188038',
                }}
              >
                Draft
              </span>
            </div>
            <button
              type="button"
              style={{
                height: 36,
                padding: '0 16px',
                border: '1px solid #dadce0',
                borderRadius: 8,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              Share
            </button>
          </>
        )}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Your title, status and actions inside the SDK bar. The shell is `display: flex` with ' +
          '`justify-content: space-between` — pass whatever children you want.',
      },
    },
  },
}

export const DifferentContent: Story = {
  name: 'A different header (breadcrumb style)',
  render: () => (
    <Shell>
      <DocumentEditor
        features={ALL_FEATURES}
        content={STARTER_DOC}
        renderHeader={(ctx) => (
          <>
            <nav style={{ fontSize: 13, color: '#5f6368' }}>
              Contracts / 2026 / <strong style={{ color: '#202124' }}>ACME renewal</strong>
            </nav>
            <span style={{ fontSize: 12, color: '#5f6368' }}>
              {ctx.api.isEmpty() ? 'empty' : 'editing'}
            </span>
          </>
        )}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The render prop receives the full context (`{ editor, api, resolved }`) — header content can be ' +
          'live (this one reads `api.isEmpty()`).',
      },
    },
  },
}

export const NoHeader: Story = {
  name: 'No header at all',
  render: () => (
    <Shell>
      <DocumentEditor features={ALL_FEATURES} content={STARTER_DOC} renderHeader={() => null} />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`renderHeader={() => null}` removes the bar entirely — the page takes the full height ' +
          '(the layout chain adapts, no math).',
      },
    },
  },
}
