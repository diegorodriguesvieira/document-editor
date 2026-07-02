import { defineFeature, Mark, mergeAttributes } from '../../editor'
import { commentsPanelContribution, getCommentThreads } from './commentsPanel'
import { promptOr } from '../promptFallback'

export interface CommentThread {
  id: string
  text: string
  quote: string
}

/** A unique-ish comment id (browser-side; fine for this demo). */
function newCommentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  )
}

/**
 * The comment ANCHOR lives in the document as a mark on the commented text, so
 * it rides along with the characters through every edit (line changes, reflow,
 * inserts) and serializes with the doc (`<span data-comment-id>`). The thread
 * (body…) lives OUTSIDE, keyed by `commentId`, in a tiny in-memory store here —
 * a real app would own it (e.g. a `CommentsProvider`, like document variables).
 * The commented text just stays highlighted; the threads are read in the side
 * panel ({@link CommentsPanel}). `excludes: ''` lets comments overlap;
 * `inclusive: false` keeps typing at the edges out of the comment.
 */
const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',

  addStorage() {
    return { threads: new Map<string, CommentThread>() }
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) =>
          attributes.commentId ? { 'data-comment-id': attributes.commentId as string } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment' }), 0]
  },
})

export const CommentsFeature = defineFeature({
  id: 'comments',
  extensions: () => [Comment],
  commands: {
    // Anchor a comment to the current selection. Payload `{ text }` skips the
    // prompt (used in tests). The thread is stored (keyed by id) and shows up
    // in the comments panel.
    'comment.add': (editor, payload) => {
      const { from, to, empty } = editor.state.selection
      if (empty) return false
      const fields = (payload ?? {}) as { text?: string }
      const text = promptOr(fields.text, 'Comment:')
      if (!text) return false
      const id = newCommentId()
      const quote = editor.state.doc.textBetween(from, to, ' ')
      const applied = editor.chain().focus().setMark('comment', { commentId: id }).run()
      if (applied) {
        getCommentThreads(editor)?.set(id, { id, text, quote })
      }
      return applied
    },
  },
  toolbar: [
    {
      id: 'comment',
      group: 'marks',
      label: 'Comment',
      icon: '💬',
      commandId: 'comment.add',
      isActive: (state) => state.isActive('comment'),
      // The anchor is the selected text — nothing selected, nothing to comment.
      isDisabled: (state) => state.isSelectionEmpty(),
    },
  ],
  // The side panel ships WITH the feature — enabling comments shows it, no
  // consumer wiring (the app can still take over the rail via renderRightBar).
  panels: [commentsPanelContribution],
})
