import { Plugin, PluginKey } from '@tiptap/pm/state'
import { defineFeature, Mark, mergeAttributes } from '../../editor'

interface CommentThread {
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

// --- A tiny DOM popover to "show" a comment on click (no React needed) ---
let popover: HTMLElement | null = null

function closePopover() {
  popover?.remove()
  popover = null
  document.removeEventListener('mousedown', onOutside, true)
  document.removeEventListener('keydown', onKey)
}
function onOutside(event: MouseEvent) {
  if (popover && !popover.contains(event.target as Node)) closePopover()
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') closePopover()
}

function showPopover(thread: CommentThread | undefined, id: string, x: number, y: number) {
  closePopover()
  popover = document.createElement('div')
  popover.className = 'comment-popover'
  popover.style.position = 'fixed'
  popover.style.left = `${x}px`
  popover.style.top = `${y + 10}px`
  popover.style.zIndex = '1200'

  if (thread?.quote) {
    const quote = document.createElement('div')
    quote.className = 'comment-popover__quote'
    quote.textContent = `“${thread.quote}”`
    popover.appendChild(quote)
  }
  const body = document.createElement('div')
  body.className = 'comment-popover__body'
  body.textContent = thread ? thread.text : `(comment ${id} — no thread loaded)`
  popover.appendChild(body)

  document.body.appendChild(popover)
  // Next tick so the click that opened it doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true)
    document.addEventListener('keydown', onKey)
  }, 0)
}

/**
 * The comment ANCHOR lives in the document as a mark on the commented text, so
 * it rides along with the characters through every edit (line changes, reflow,
 * inserts) and serializes with the doc (`<span data-comment-id>`). The thread
 * (author, body…) lives OUTSIDE, keyed by `commentId` — here we keep a tiny
 * in-memory store in the mark's `storage` and show it in a popover on click. A
 * real app would own that store (e.g. a `CommentsProvider`, like variables).
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

  addProseMirrorPlugins() {
    const storage = this.storage as { threads: Map<string, CommentThread> }
    return [
      new Plugin({
        key: new PluginKey('commentClick'),
        props: {
          handleClick: (view, pos, event) => {
            const marks = view.state.doc.nodeAt(pos)?.marks ?? view.state.doc.resolve(pos).marks()
            const mark = marks.find((m) => m.type.name === 'comment')
            if (!mark) {
              closePopover()
              return false
            }
            const id = mark.attrs.commentId as string
            showPopover(storage.threads.get(id), id, event.clientX, event.clientY)
            return false // don't block the default caret placement
          },
        },
      }),
    ]
  },
})

export const CommentsFeature = defineFeature({
  id: 'comments',
  extensions: () => [Comment],
  commands: {
    // Anchor a comment to the current selection. Payload `{ text }` skips the
    // prompt (used in tests). The thread is stored (keyed by id) + logged.
    'comment.add': (editor, payload) => {
      const { from, to, empty } = editor.state.selection
      if (empty) return false
      const fields = (payload ?? {}) as { text?: string }
      const text =
        typeof fields.text === 'string'
          ? fields.text
          : typeof window !== 'undefined'
            ? (window.prompt('Comment:') ?? '')
            : ''
      if (!text) return false
      const id = newCommentId()
      const quote = editor.state.doc.textBetween(from, to, ' ')
      const applied = editor.chain().focus().setMark('comment', { commentId: id }).run()
      if (applied) {
        const thread: CommentThread = { id, text, quote }
        const store = editor.storage as unknown as Record<string, { threads: Map<string, CommentThread> }>
        store.comment.threads.set(id, thread)
        console.log('[comment]', { ...thread, range: { from, to } })
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
    },
  ],
})
