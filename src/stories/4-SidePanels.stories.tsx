import type { Meta, StoryObj } from '@storybook/react-vite'
import { DocumentEditor, InsertToolbar } from '../editor'
import { CommentsPanel } from '../features'
import { ALL_FEATURES, Shell, COMMENTED_DOC, STARTER_DOC } from './storyShell'


const meta = {
  title: 'Editor/4. Side panels',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Both gutters are CONSUMER-owned: `renderLeftPanel` / `renderRightPanel` render anything, ' +
          'pinned to the viewport edges (`--editor-rail-gutter`). They receive the same context as ' +
          'every render prop — so even the insert actions can move into a panel.',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

export const ActionsInTheLeftPanel: Story = {
  name: 'Insert actions in the LEFT panel',
  render: () => (
    <Shell>
      <style>{`
        .sb-side-actions {
          position: sticky;
          top: 16px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 6px;
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(60, 64, 67, 0.15);
        }
      `}</style>
      <DocumentEditor
        features={ALL_FEATURES}
        content={STARTER_DOC}
        renderFooter={() => null}
        renderLeftPanel={(ctx) => <InsertToolbar {...ctx} className="sb-side-actions" />}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The recipe: suppress the footer (`renderFooter={() => null}`) and drop the headless ' +
          '`InsertToolbar` into `renderLeftPanel` with your own class — here styled as a vertical ' +
          'sticky card. Same live actions, different surface; the `/` menu keeps mirroring them.',
      },
    },
  },
}

export const CommentsInTheRightPanel: Story = {
  name: 'Comments panel on the right',
  render: () => (
    <Shell>
      <DocumentEditor
        features={ALL_FEATURES}
        content={COMMENTED_DOC}
        renderRightPanel={(ctx) => <CommentsPanel editor={ctx.editor} />}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "The SDK's `CommentsPanel` dropped into the right gutter (or rebuild your own UI on the " +
          '`useDocumentComments` hook — same reactive data, click-to-scroll included). The panel ' +
          'renders nothing when there are no comments; this document ships one anchored comment.',
      },
    },
  },
}
