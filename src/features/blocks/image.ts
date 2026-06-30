import { Image } from '@tiptap/extension-image'
import { defineFeature } from '../../editor'

/**
 * Allow http(s)/data and relative URLs; reject `javascript:` and other script
 * protocols (mirrors what TipTap's Link does for hrefs). The doc's HTML is the
 * backend/PDF contract, so an attacker-controlled `src` must not smuggle a
 * script URL. (SSRF on internal hosts is still the backend's job to guard.)
 */
function isSafeImageSrc(src: string): boolean {
  try {
    const url = new URL(src, 'https://base.invalid/')
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:'
  } catch {
    return false
  }
}

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
            ? (window.prompt('Image URL:') ?? '')
            : ''
      if (!src || !isSafeImageSrc(src)) return false
      return editor.chain().focus().setImage({ src }).run()
    },
  },
  insert: [{ id: 'image', label: 'Image', icon: 'I', commandId: 'image.insert' }],
})
