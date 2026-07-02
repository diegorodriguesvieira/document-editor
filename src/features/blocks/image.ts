import { Image } from '@tiptap/extension-image'
import { defineFeature } from '../../editor'
import { promptOr } from '../promptFallback'

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

const MIN_WIDTH = 60

/**
 * TipTap's Image + resize: a `width` attribute (px) written by drag handles in
 * a pure-DOM node view (same idiom as the merge-field chip — no React needed).
 * Height stays `auto`, so the aspect ratio is always preserved; width is
 * clamped between MIN_WIDTH and the content column. Serialized as the standard
 * HTML `width` attribute — the backend/PDF contract stays plain HTML.
 */
const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('width') ?? element.style.width
          const value = raw ? Number.parseInt(String(raw), 10) : NaN
          return Number.isFinite(value) && value > 0 ? value : null
        },
        renderHTML: (attributes) =>
          attributes.width ? { width: String(attributes.width) } : {},
      },
    }
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let current = node
      const dom = document.createElement('div')
      dom.className = 'image-resizer'
      const img = document.createElement('img')
      img.draggable = false // ProseMirror owns block dragging; kill the native ghost
      const sync = (n: typeof node) => {
        if (img.getAttribute('src') !== n.attrs.src) img.setAttribute('src', n.attrs.src as string)
        if (n.attrs.alt) img.alt = n.attrs.alt as string
        if (n.attrs.title) img.title = n.attrs.title as string
        img.style.width = n.attrs.width ? `${n.attrs.width}px` : ''
      }
      sync(node)
      dom.appendChild(img)

      let drag: { startX: number; startWidth: number; dir: 1 | -1; width: number; moved: boolean } | null = null
      const onMove = (event: MouseEvent) => {
        if (!drag) return
        drag.moved = true
        // Live feedback is style-only; the document is written once, on drop.
        const max = dom.parentElement?.clientWidth || Number.POSITIVE_INFINITY
        const next = drag.startWidth + drag.dir * (event.clientX - drag.startX)
        drag.width = Math.round(Math.min(Math.max(next, MIN_WIDTH), max))
        img.style.width = `${drag.width}px`
      }
      const onUp = () => {
        if (!drag) return
        const { width, moved } = drag
        drag = null
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        const pos = typeof getPos === 'function' ? getPos() : null
        // A click on a handle without movement writes nothing (no undo noise).
        if (moved && pos != null && width !== current.attrs.width) {
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, width }))
        } else {
          sync(current)
        }
      }
      for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
        const handle = document.createElement('span')
        handle.className = `image-resizer__handle image-resizer__handle--${corner}`
        handle.addEventListener('mousedown', (event) => {
          event.preventDefault()
          event.stopPropagation()
          drag = {
            startX: event.clientX,
            startWidth: img.offsetWidth || (current.attrs.width as number) || MIN_WIDTH,
            dir: corner.endsWith('e') ? 1 : -1, // west handles grow leftwards
            width: img.offsetWidth,
            moved: false,
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        })
        dom.appendChild(handle)
      }

      return {
        dom,
        update(next) {
          if (next.type.name !== current.type.name) return false
          current = next
          sync(next)
          return true
        },
        // Handles only show while the node is selected (click the image).
        selectNode() {
          dom.classList.add('image-resizer--selected')
        },
        deselectNode() {
          dom.classList.remove('image-resizer--selected')
        },
        // Keep ProseMirror out of the handle drag (it would start a node drag).
        stopEvent(event) {
          return (
            event.target instanceof Element &&
            event.target.closest('.image-resizer__handle') !== null
          )
        },
        destroy() {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
        },
      }
    }
  },
})

/** Image. The command takes an src payload, or prompts as a fallback. */
export const ImageFeature = defineFeature({
  id: 'image',
  extensions: () => [ResizableImage],
  commands: {
    'image.insert': (editor, payload) => {
      const src = promptOr(payload, 'Image URL:')
      if (!src || !isSafeImageSrc(src)) return false
      return editor.chain().focus().setImage({ src }).run()
    },
  },
  // Mod-Alt-p ("picture"): Mod-Shift-i collides with Safari's Mail Contents
  // of Page; the Alt+I/J/C/K/U row is devtools territory across browsers.
  keymap: { 'Mod-Alt-p': 'image.insert' },
  insert: [{ id: 'image', label: 'Image', icon: 'I', commandId: 'image.insert' }],
})
