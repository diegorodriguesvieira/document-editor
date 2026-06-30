import { Link } from '@tiptap/extension-link'
import { defineFeature } from '../../editor'

/** Link mark. The command accepts an href payload, or prompts as a fallback. */
export const LinkFeature = defineFeature({
  id: 'link',
  // `inclusive: () => false` so typing right after ANY link doesn't extend it
  // (TipTap couples inclusive to `autolink`, which defaults to on).
  extensions: () => [Link.extend({ inclusive: () => false }).configure({ openOnClick: false })],
  commands: {
    'link.set': (editor, payload) => {
      const href =
        typeof payload === 'string'
          ? payload
          : typeof window !== 'undefined'
            ? (window.prompt('Link URL:') ?? '')
            : ''
      if (!href) {
        return editor.chain().focus().unsetLink().run()
      }
      return editor.chain().focus().setLink({ href }).run()
    },
    'link.unset': (editor) => editor.chain().focus().unsetLink().run(),
    // Insert flow: ask for the visible text AND the URL, then insert a new
    // linked run at the cursor. Payload `{ text, href }` skips the prompts.
    'link.insert': (editor, payload) => {
      const fields = (payload ?? {}) as { text?: string; href?: string }
      const text =
        typeof fields.text === 'string'
          ? fields.text
          : typeof window !== 'undefined'
            ? (window.prompt('Link text:') ?? '')
            : ''
      if (!text) return false
      const href =
        typeof fields.href === 'string'
          ? fields.href
          : typeof window !== 'undefined'
            ? (window.prompt('Link URL:') ?? '')
            : ''
      if (!href) return false
      return editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
        .run()
    },
  },
  toolbar: [
    {
      id: 'link',
      group: 'marks',
      label: 'Link',
      icon: '🔗',
      commandId: 'link.set',
      isActive: (state) => state.isActive('link'),
    },
  ],
  insert: [
    {
      id: 'link',
      label: 'Link',
      icon: 'L',
      commandId: 'link.insert',
      isActive: (state) => state.isActive('link'),
    },
  ],
})
