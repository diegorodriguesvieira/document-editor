import { defineFeature, mergeAttributes, Node } from '../../editor'

const DEFAULT_EMOJI = '💡'

/**
 * Example "team" feature: a Callout block. It's just chrome (an emoji) around
 * editable content, so it uses a PURE-DOM node view — no React subtree per
 * node. That's the SDK's default stance: reach for `ReactNodeViewRenderer`
 * only when a node genuinely needs React state/hooks (it multiplies mount and
 * update cost on large documents). It still imports from `../editor`, never
 * `@tiptap/*` — the engine stays an SDK detail.
 */
const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: DEFAULT_EMOJI,
        parseHTML: (element) => element.getAttribute('data-emoji') ?? DEFAULT_EMOJI,
        renderHTML: (attributes) => ({ 'data-emoji': attributes.emoji as string }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'callout'
      const emoji = document.createElement('span')
      emoji.className = 'callout__emoji'
      emoji.contentEditable = 'false'
      emoji.textContent = (node.attrs.emoji as string) ?? DEFAULT_EMOJI
      const content = document.createElement('div')
      content.className = 'callout__content'
      dom.append(emoji, content)
      return {
        dom,
        // ProseMirror renders the editable children into contentDOM.
        contentDOM: content,
        update: (updated) => {
          if (updated.type.name !== 'callout') return false
          emoji.textContent = (updated.attrs.emoji as string) ?? DEFAULT_EMOJI
          return true
        },
      }
    }
  },
})

export const CalloutFeature = defineFeature({
  id: 'callout',
  extensions: () => [CalloutNode],
  commands: {
    // Built-in core command — no per-feature type augmentation needed.
    'callout.toggle': (editor) => editor.chain().focus().toggleWrap('callout').run(),
  },
  // A genuinely new shortcut, routed through the SDK's registry keymap.
  keymap: { 'Mod-Shift-c': 'callout.toggle' },
  toolbar: [
    {
      id: 'callout',
      group: 'blocks',
      label: 'Callout',
      icon: '💡',
      commandId: 'callout.toggle',
      isActive: (state) => state.isActive('callout'),
    },
  ],
})
