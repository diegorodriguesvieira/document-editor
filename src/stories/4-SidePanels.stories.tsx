import type { Meta, StoryObj } from '@storybook/react-vite'
import { BubbleToolbar, DocumentEditor, InsertToolbar } from '../editor'
import {
  CommentsLayer,
  CommentsPanel,
  CommentsProvider,
  type CommentsAdapter,
  type DocumentComment,
} from '../features'
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

// In-memory adapter seeded with one comment anchored on the "30 days" range
// of COMMENTED_DOC — the story-sized version of a real HTTP adapter.
function storyAdapter(): CommentsAdapter {
  let db: DocumentComment[] = [
    {
      id: 'c-1',
      from: 37,
      to: 44,
      quote: '30 days',
      text: 'Can we make this 15 days?',
      author: { id: 'u-reviewer', name: 'Rita Reviewer' },
      createdAt: '2026-07-15T12:00:00Z',
    },
  ]
  return {
    async list() {
      return [...db]
    },
    async add(input) {
      db = [
        ...db,
        {
          ...input,
          id: `c-${db.length + 1}`,
          author: { id: 'u-you', name: 'You' },
          createdAt: new Date().toISOString(),
        },
      ]
    },
    async remove(id) {
      db = db.filter((comment) => comment.id !== id)
    },
  }
}

export const CommentsInTheRightPanel: Story = {
  name: 'Review comments on the right',
  render: () => (
    <Shell>
      <CommentsProvider user={{ id: 'u-you', name: 'You' }} adapter={storyAdapter()}>
        <DocumentEditor
          features={ALL_FEATURES}
          content={COMMENTED_DOC}
          editable={false}
          renderBubble={(ctx) => (
            <>
              <BubbleToolbar {...ctx} />
              <CommentsLayer editor={ctx.editor} />
            </>
          )}
          renderRightPanel={(ctx) => <CommentsPanel editor={ctx.editor} />}
        />
      </CommentsProvider>
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Comments are a REVIEW-mode surface: the editor is `editable={false}`, highlights are ' +
          'decorations fed by the consumer’s `CommentsAdapter` (the doc never mutates), selecting ' +
          'text floats the "Add comment" balloon (`CommentsLayer`), and the SDK `CommentsPanel` ' +
          'lists avatar + author + text with delete on your own comments. In edit mode nothing ' +
          'comment-related renders.',
      },
    },
  },
}
