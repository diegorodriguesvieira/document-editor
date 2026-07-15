import type { Meta, StoryObj } from '@storybook/react-vite'
import { DocumentEditor, InsertToolbar } from '../editor'
import { ALL_FEATURES, Shell, STARTER_DOC } from './storyShell'


const meta = {
  title: 'Editor/3. Footer',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The footer is the fixed rounded bar over the page bottom (`--editor-dock-height`, 66px). ' +
          'By default it carries the insert ACTIONS. `renderFooter` keeps the shell and swaps the ' +
          'content; returning `null` removes the footer entirely (read-only mode) — the page ' +
          'clearance goes with it. The document always scrolls BEHIND the bar.',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

export const DefaultActions: Story = {
  name: 'Default: the insert actions',
  render: () => (
    <Shell>
      <DocumentEditor features={ALL_FEATURES} content={STARTER_DOC} />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Omit `renderFooter` and the footer shows every opted-in insert action, centered.',
      },
    },
  },
}

export const CustomButtons: Story = {
  name: 'Custom buttons alongside the actions',
  render: () => (
    <Shell>
      <DocumentEditor
        features={ALL_FEATURES}
        content={STARTER_DOC}
        renderFooter={(ctx) => (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
            }}
          >
            <span style={{ justifySelf: 'start', fontSize: 12, color: '#5f6368' }}>
              Saved just now
            </span>
            <InsertToolbar {...ctx} className="sb-footer-actions" />
            <style>{`.sb-footer-actions { height: 100%; display: flex; align-items: center; gap: 4px; }`}</style>
            <button
              type="button"
              style={{
                justifySelf: 'end',
                height: 40,
                padding: '0 24px',
                border: 'none',
                borderRadius: 10,
                background: '#1b1b1b',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={() => console.log('send →', ctx.api.getJSON())}
            >
              Send
            </button>
          </div>
        )}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The shell stays; the content is yours. A `1fr auto 1fr` grid keeps the actions geometrically ' +
          'centered while your extras take the sides — `InsertToolbar` is headless (the `className` ' +
          'replaces its default skin), so the REAL live actions drop into your composition.',
      },
    },
  },
}

export const NoFooter: Story = {
  name: 'No footer (read-only composition)',
  render: () => (
    <Shell>
      <DocumentEditor
        features={ALL_FEATURES}
        content={STARTER_DOC}
        renderFooter={() => null}
        renderBubble={() => null}
        onReady={(api) => api.focus()}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`renderFooter={() => null}` removes the bar AND the page clearance under it. Combined with ' +
          '`renderBubble={() => null}` this is the read-only presentation (the content itself stays ' +
          'editable unless your app also disables editing).',
      },
    },
  },
}
