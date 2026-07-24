import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { BubbleToolbar, DocumentEditor, type Editor } from '../editor'
import {
  CommentsLayer,
  CommentsPanel,
  CommentsProvider,
  useComments,
  type CommentsAdapter,
  type DocumentComment,
} from '../features'
import { ALL_FEATURES, Shell, COMMENTED_DOC } from './storyShell'


const meta = {
  title: 'Editor/9. Comments',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Comments are anchored IN the document — a `comment` mark carrying only the backend id ' +
          '(`data-comment-id` in HTML, `marks: [{ type: "comment" }]` in JSON) — while their content ' +
          '(text, author, replies, permissions) stays backend-side behind the consumer\'s ' +
          '`CommentsAdapter`. Marks move with the text through edits, so highlights and the ' +
          '`CommentsPanel` exist in BOTH modes; only COMPOSING a new comment (the `CommentsLayer` ' +
          'balloon) is review-mode-only. Each comment/reply carries `canEdit`/`canReply`/`canDelete` ' +
          'stamped by the backend — the panel renders actions from those flags alone. Replies are ' +
          'ONE level (no reply-to-reply).',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

// In-memory adapter seeded with the comment whose mark COMMENTED_DOC carries
// ('c-1' on "30 days") — the story-sized version of a real HTTP adapter. The
// backend owns content, IDs and the PERMISSION flags: Rita's comment is not
// yours (reply only), your own content gets edit/delete. `add` returns the
// created comment so the editor can anchor its mark; `update`/`remove` take a
// comment OR reply id (ids are globally unique).
const YOU = { id: 'u-you', name: 'You' }

function storyAdapter(): CommentsAdapter {
  let db: DocumentComment[] = [
    {
      id: 'c-1',
      quote: '30 days',
      text: 'Can we make this 15 days?',
      author: { id: 'u-reviewer', name: 'Rita Reviewer' },
      createdAt: '2026-07-15T12:00:00Z',
      status: 'open',
      canEdit: false,
      canReply: true,
      canDelete: false,
      // Resolving/archiving SOMEONE ELSE's comment is normal reviewer work.
      canResolve: true,
      canArchive: true,
      replies: [
        {
          id: 'r-1',
          text: 'Checking with legal, one sec.',
          author: YOU,
          createdAt: '2026-07-15T14:00:00Z',
          canEdit: true,
          canDelete: true,
        },
      ],
    },
    // Already resolved (no mark in COMMENTED_DOC — resolved comments carry
    // none) so the Resolved tab opens populated.
    {
      id: 'c-2',
      quote: 'Review me',
      text: 'Title casing looks off.',
      author: { id: 'u-reviewer', name: 'Rita Reviewer' },
      createdAt: '2026-07-14T09:00:00Z',
      status: 'resolved',
      canEdit: false,
      canReply: true,
      canDelete: true,
      canResolve: false,
      canArchive: false,
      replies: [],
    },
  ]
  return {
    async list() {
      return db.map((comment) => ({
        ...comment,
        replies: comment.replies?.map((reply) => ({ ...reply })),
      }))
    },
    async add(input) {
      const created: DocumentComment = {
        ...input,
        id: `c-${db.length + 1}`,
        author: YOU,
        createdAt: new Date().toISOString(),
        status: 'open',
        canEdit: true,
        canReply: true,
        canDelete: true,
        canResolve: true,
        canArchive: true,
        replies: [],
      }
      db = [...db, created]
      return created
    },
    async reply(commentId, input) {
      db = db.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              replies: [
                ...(comment.replies ?? []),
                {
                  ...input,
                  id: `r-${Math.random().toString(36).slice(2, 8)}`,
                  author: YOU,
                  createdAt: new Date().toISOString(),
                  canEdit: true,
                  canDelete: true,
                },
              ],
            }
          : comment,
      )
    },
    async update(id, input) {
      db = db.map((comment) =>
        comment.id === id
          ? { ...comment, text: input.text }
          : {
              ...comment,
              replies: comment.replies?.map((reply) =>
                reply.id === id ? { ...reply, text: input.text } : reply,
              ),
            },
      )
    },
    async setStatus(id, input) {
      db = db.map((comment) =>
        comment.id === id ? { ...comment, status: input.status } : comment,
      )
    },
    async remove(id) {
      db = db
        .filter((comment) => comment.id !== id)
        .map((comment) => ({
          ...comment,
          replies: comment.replies?.filter((reply) => reply.id !== id),
        }))
    },
  }
}

// Story-only debugging: dumps the doc on EVERY change (typing, a comment mark
// landing/leaving) and the backend list whenever it refetches (add/remove).
function LogDocAndComments({ editor }: { editor: Editor }) {
  const comments = useComments()?.comments
  useEffect(() => {
    console.log('doc JSON', editor.getJSON())
    const log = () => console.log('doc JSON', editor.getJSON())
    editor.on('update', log)
    return () => {
      editor.off('update', log)
    }
  }, [editor])
  useEffect(() => {
    console.log('comments JSON', comments)
  }, [comments])
  return null
}

export const ReviewMode: Story = {
  name: 'Review mode: read, compose, delete',
  render: () => (
    <Shell>
      <CommentsProvider user={YOU} adapter={storyAdapter()}>
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
          renderRightPanel={(ctx) => (
            <>
              <LogDocAndComments editor={ctx.editor} />
              <CommentsPanel editor={ctx.editor} />
            </>
          )}
        />
      </CommentsProvider>
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The full review loop: selecting text floats the "Add comment" balloon (`CommentsLayer`), ' +
          'the panel opens its composer on the captured draft, and saving anchors the backend\'s id ' +
          'into the doc as a mark. Clicking a highlight activates its card and vice-versa. Rita\'s ' +
          'seeded thread shows the permission flags at work: her comment offers only Reply (not ' +
          'yours to edit/delete), while your own seeded reply — and anything you create — carries ' +
          'the 3-dots with Edit/Delete.',
      },
    },
  },
}

export const CustomMenuItems: Story = {
  name: 'Consumer menu items',
  render: () => (
    <Shell>
      <CommentsProvider user={YOU} adapter={storyAdapter()}>
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
          renderRightPanel={(ctx) => (
            <CommentsPanel
              editor={ctx.editor}
              // CONSUMER extension: items are data, land between the
              // built-ins and Delete, and see the full comment (status
              // included) to decide what frozen cards get.
              commentMenuItems={(comment) => [
                {
                  label: 'Copy link',
                  onClick: () => console.log('[consumer] copy link', `#comment-${comment.id}`),
                },
                {
                  label: 'Report',
                  // Opts into the same 2-step confirm the Delete uses.
                  confirmLabel: 'Confirm report?',
                  onClick: () => console.log('[consumer] reported', comment.id),
                },
              ]}
              replyMenuItems={(reply, comment) => [
                {
                  label: 'Quote reply',
                  onClick: () => console.log('[consumer] quote', reply.id, 'of', comment.id),
                },
              ]}
            />
          )}
        />
      </CommentsProvider>
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The stock panel, EXTENDED by the consumer: `commentMenuItems`/`replyMenuItems` return ' +
          'plain `ActionsMenuItem` data — "Copy link" and a 2-step "Report" (`confirmLabel`) on ' +
          'every card, "Quote reply" on reply rows. Items land between the built-ins and Delete; ' +
          'open the browser console to see them fire. Rita\'s comment (no edit/delete flags) shows ' +
          'the menu rendering with consumer items even where the backend grants nothing.',
      },
    },
  },
}

export const EditMode: Story = {
  name: 'Edit mode: highlights persist',
  render: () => (
    <Shell>
      <CommentsProvider user={YOU} adapter={storyAdapter()}>
        <DocumentEditor
          features={ALL_FEATURES}
          content={COMMENTED_DOC}
          renderBubble={(ctx) => (
            <>
              <BubbleToolbar {...ctx} />
              <CommentsLayer editor={ctx.editor} />
            </>
          )}
          renderRightPanel={(ctx) => (
            <>
              <LogDocAndComments editor={ctx.editor} />
              <CommentsPanel editor={ctx.editor} />
            </>
          )}
        />
      </CommentsProvider>
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The same doc, EDITABLE: highlights and the panel stay (the mark moves with the text as ' +
          'you type), but there is no way to ADD a new comment — the balloon is review-only. ' +
          'Replying and editing still work here. Typing at a highlight\'s edge does not extend it ' +
          '(`inclusive: false`), copy/paste strips comment marks, and deleting the highlighted ' +
          'text flips its card to ORPHANED (original quote + hint) — still replyable and deletable.',
      },
    },
  },
}
