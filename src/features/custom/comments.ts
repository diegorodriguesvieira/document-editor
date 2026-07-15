import { defineFeature, Extension } from '../../editor'
import type { Editor } from '../../editor'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { CommentDraft, DocumentComment } from './commentsProvider'

/**
 * What the decoration plugin reads. {@link CommentsLayer} keeps it in sync
 * with the {@link CommentsProvider} (and nudges a re-render); the plugin only
 * ever derives from it — comments never touch the document itself.
 */
export interface CommentsStorage {
  comments: DocumentComment[]
  draft: CommentDraft | null
  activeId: string | null
  /** Set by {@link CommentsLayer}: a document click landed ON a comment
   *  highlight (its id) or OFF every highlight (null) — drives the panel's
   *  active card, the mirror of the panel's click-to-highlight. */
  onCommentClick: ((id: string | null) => void) | null
}

/**
 * The one typed accessor for the comments storage — the single place the
 * `editor.storage` cast lives, beside the extension that owns that storage.
 */
export function getCommentsStorage(editor: Editor): CommentsStorage | undefined {
  const storage = editor.storage as unknown as { comments?: CommentsStorage }
  return storage.comments
}

/**
 * Comments are a REVIEW-mode overlay: they exist only while the editor is
 * read-only, live backend-side (see {@link CommentsAdapter}) and render as
 * ProseMirror DECORATIONS — the document never mutates and never serializes
 * them. In edit mode the plugin returns nothing, deliberately: anchors are
 * absolute positions in the reviewed document, so an edited document would
 * drift them (re-anchoring by quote is a future concern, not this one's).
 */
const CommentsKernel = Extension.create({
  name: 'comments',

  addStorage(): CommentsStorage {
    return { comments: [], draft: null, activeId: null, onCommentClick: null }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const storage = this.storage as CommentsStorage
    return [
      new Plugin({
        key: new PluginKey('commentDecorations'),
        props: {
          decorations: (state) => {
            if (editor.isEditable) return null
            // Backend positions can outlive the doc revision they were made
            // on — clamp instead of throwing, and drop emptied ranges.
            const max = state.doc.content.size
            const clamp = (pos: number) => Math.max(0, Math.min(pos, max))
            const decorations: Decoration[] = []
            for (const comment of storage.comments) {
              const from = clamp(comment.from)
              const to = clamp(comment.to)
              if (from >= to) continue
              const active = comment.id === storage.activeId
              decorations.push(
                Decoration.inline(from, to, {
                  class: active ? 'comment comment--active' : 'comment',
                  'data-comment-id': comment.id,
                }),
              )
            }
            if (storage.draft) {
              const from = clamp(storage.draft.from)
              const to = clamp(storage.draft.to)
              if (from < to) {
                decorations.push(Decoration.inline(from, to, { class: 'comment comment--draft' }))
              }
            }
            return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null
          },
          // Clicking a highlight activates its comment in the panel (the
          // mirror of the panel's click-to-scroll); clicking plain text
          // deactivates. Never consumes the click — the caret still lands.
          handleClick: (_view, pos) => {
            if (editor.isEditable) return false
            const notify = storage.onCommentClick
            if (!notify) return false
            // Overlaps: the INNERMOST (smallest) covering comment wins.
            let hit: DocumentComment | null = null
            for (const comment of storage.comments) {
              if (pos < comment.from || pos > comment.to) continue
              if (!hit || comment.to - comment.from < hit.to - hit.from) hit = comment
            }
            notify(hit ? hit.id : null)
            return false
          },
        },
      }),
    ]
  },
})

/**
 * Review-mode comments: the decoration kernel only. The UI lives in
 * {@link CommentsLayer} (the "Add comment" balloon) and {@link CommentsPanel}
 * (composer + cards), both fed by {@link CommentsProvider}.
 *
 * Contributes — extensions only (no bubble/insert items): comment highlights
 * as read-only decorations. In edit mode nothing renders, by design.
 */
export const CommentsFeature = defineFeature({
  id: 'comments',
  extensions: () => [CommentsKernel],
})
