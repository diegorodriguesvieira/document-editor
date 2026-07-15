import { defineFeature, Mark, mergeAttributes } from '../../editor'
import { promptOr } from '../promptFallback'
import type { Editor } from '../../editor'
import { icons } from '../icons'
import { commentAddActive, commentAddDisabled, renderCommentAddControl } from '../promptForms'

export interface CommentThread {
  id: string
  text: string
}

/**
 * The one typed accessor for the comment mark's storage — the single place the
 * `editor.storage` cast lives, beside the mark that owns that storage.
 */
export function getCommentThreads(editor: Editor): Map<string, CommentThread> | undefined {
  const storage = editor.storage as unknown as { comment?: { threads: Map<string, CommentThread> } }
  return storage.comment?.threads
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
    // prompt (the bubble's comment form and tests pass it; bare exec falls
    // back to window.prompt). The thread is stored (keyed by id) and shows up
    // in the comments panel.
    'comment.add': (editor, payload) => {
      const { empty } = editor.state.selection
      if (empty) return false
      const fields = (payload ?? {}) as { text?: string }
      const text = promptOr(fields.text, 'Comment:')
      if (!text) return false
      const id = newCommentId()
      const applied = editor.chain().focus().setMark('comment', { commentId: id }).run()
      if (applied) {
        // The thread stores only the WHAT (the body); the quote is derived
        // live from the anchored range, so it survives edits to the text.
        getCommentThreads(editor)?.set(id, { id, text })
      }
      return applied
    },
  },
  bubble: [
    {
      id: 'comment',
      group: 'marks',
      label: 'Comment',
      icon: icons.comment,
      commandId: 'comment.add',
      // Comment-text form → exec('comment.add', { text }).
      render: renderCommentAddControl,
      isActive: commentAddActive,
      // The anchor is the selected text — nothing selected, nothing to comment.
      isDisabled: commentAddDisabled,
    },
  ],
})
