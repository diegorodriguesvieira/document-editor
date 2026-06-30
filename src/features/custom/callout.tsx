import {
  defineFeature,
  mergeAttributes,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '../../editor'

/**
 * Example "team" feature: a Callout block with a custom React node view.
 * Notice it imports its building blocks from `../editor` (the SDK surface),
 * never from `@tiptap/*` — the engine stays an SDK implementation detail.
 */
function CalloutView({ node }: NodeViewProps) {
  const emoji = typeof node.attrs.emoji === 'string' ? node.attrs.emoji : '💡'
  return (
    <NodeViewWrapper className="callout">
      <span className="callout__emoji" contentEditable={false}>
        {emoji}
      </span>
      <NodeViewContent className="callout__content" />
    </NodeViewWrapper>
  )
}

const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: '💡',
        parseHTML: (element) => element.getAttribute('data-emoji') ?? '💡',
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
    return ReactNodeViewRenderer(CalloutView)
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
