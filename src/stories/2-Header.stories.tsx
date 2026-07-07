import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  DocumentEditor,
  useFeatureState,
  type DocumentEditorRenderContext,
} from '../editor'
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

/** LIVE header state: the render prop is invoked on React renders, not on
 *  document transactions — reactive reads go through `useFeatureState`. */
function DocumentStatus({ ctx }: { ctx: DocumentEditorRenderContext }) {
  const isEmpty = useFeatureState(ctx.editor, () => ctx.api.isEmpty())
  return (
    <span style={{ fontSize: 12, color: '#5f6368' }}>{isEmpty ? 'empty' : 'editing'}</span>
  )
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
            <DocumentStatus ctx={ctx} />
          </>
        )}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The render prop receives the full context (`{ editor, api, resolved }`). For LIVE state ' +
          '(this status flips as you edit), put a small component in the header and read the document ' +
          'through `useFeatureState(ctx.editor, () => ctx.api.isEmpty())` — the render prop itself is ' +
          'only re-invoked on React renders, not on every document transaction.',
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
