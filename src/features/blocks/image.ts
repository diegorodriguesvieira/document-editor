import { Image } from '@tiptap/extension-image'
import { defineFeature } from '../../editor'

/** Image. The command takes an src payload, or prompts as a fallback. */
export const ImageFeature = defineFeature({
  id: 'image',
  extensions: () => [Image],
  commands: {
    'image.insert': (editor, payload) => {
      const src =
        typeof payload === 'string'
          ? payload
          : typeof window !== 'undefined'
            ? (window.prompt('URL da imagem:') ?? '')
            : ''
      if (!src) return false
      return editor.chain().focus().setImage({ src }).run()
    },
  },
  insert: [{ id: 'image', label: 'Imagem', icon: 'I', commandId: 'image.insert' }],
})
