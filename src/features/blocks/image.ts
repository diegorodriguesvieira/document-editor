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
const MIN_HEIGHT = 40

function parseDimension(raw: string | null): number | null {
  const value = raw ? Number.parseInt(String(raw), 10) : NaN
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * The 8 handles. `dx`/`dy` say which axis each handle drives (Docs semantics):
 * corners resize proportionally; edge handles stretch ONE dimension and freeze
 * the other (deliberate distortion, like Google Docs).
 */
const HANDLES: Array<{ id: string; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }> = [
  { id: 'nw', dx: -1, dy: -1 },
  { id: 'n', dx: 0, dy: -1 },
  { id: 'ne', dx: 1, dy: -1 },
  { id: 'w', dx: -1, dy: 0 },
  { id: 'e', dx: 1, dy: 0 },
  { id: 'sw', dx: -1, dy: 1 },
  { id: 's', dx: 0, dy: 1 },
  { id: 'se', dx: 1, dy: 1 },
]

/**
 * TipTap's Image + Docs-style resize, in a pure-DOM node view (same idiom as
 * the merge-field chip — no React needed): 8 handles, corners keep the aspect
 * ratio, edge handles stretch width OR height and freeze the other. Live
 * feedback is style-only; the document is written ONCE on drop (a single
 * clean undo step). `width`/`height` serialize as standard HTML attributes —
 * the backend/PDF contract stays plain HTML.
 */
const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) =>
          parseDimension(element.getAttribute('width') ?? element.style.width),
        renderHTML: (attributes) =>
          attributes.width ? { width: String(attributes.width) } : {},
      },
      height: {
        default: null,
        parseHTML: (element) =>
          parseDimension(element.getAttribute('height') ?? element.style.height),
        renderHTML: (attributes) =>
          attributes.height ? { height: String(attributes.height) } : {},
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
        img.style.height = n.attrs.height ? `${n.attrs.height}px` : ''
      }
      sync(node)
      dom.appendChild(img)

      const setAttrs = (attrs: Record<string, unknown>) => {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }))
      }

      let drag: {
        startX: number
        startY: number
        startW: number
        startH: number
        dx: -1 | 0 | 1
        dy: -1 | 0 | 1
        width: number
        height: number
        moved: boolean
      } | null = null
      const onMove = (event: MouseEvent) => {
        if (!drag) return
        drag.moved = true
        // Live feedback is style-only; the document is written once, on drop.
        const max = dom.parentElement?.clientWidth || Number.POSITIVE_INFINITY
        if (drag.dx !== 0) {
          const next = drag.startW + drag.dx * (event.clientX - drag.startX)
          drag.width = Math.round(Math.min(Math.max(next, MIN_WIDTH), max))
          if (drag.dy !== 0) {
            // Corner: proportional — height follows the width's scale.
            drag.height = Math.round((drag.startH * drag.width) / drag.startW)
          }
        }
        if (drag.dx === 0 && drag.dy !== 0) {
          const next = drag.startH + drag.dy * (event.clientY - drag.startY)
          drag.height = Math.round(Math.max(next, MIN_HEIGHT))
        }
        img.style.width = `${drag.width}px`
        img.style.height = `${drag.height}px`
      }
      const onUp = () => {
        if (!drag) return
        const { dx, dy, width, height, moved } = drag
        drag = null
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        // A click on a handle without movement writes nothing (no undo noise).
        if (!moved) {
          sync(current)
          return
        }
        if (dx !== 0 && dy !== 0) {
          // Corner: keep proportionality. Height is stored only if it already
          // was (a never-stretched image stays natural-ratio via height:auto).
          setAttrs(current.attrs.height != null ? { width, height } : { width })
        } else {
          // Edge handles: stretch one dimension, FREEZE the other at its
          // current pixels (deliberate distortion, like Docs).
          setAttrs({ width, height })
        }
      }
      for (const { id, dx, dy } of HANDLES) {
        const handle = document.createElement('span')
        handle.className = `image-resizer__handle image-resizer__handle--${id}`
        handle.addEventListener('mousedown', (event) => {
          event.preventDefault()
          event.stopPropagation()
          drag = {
            startX: event.clientX,
            startY: event.clientY,
            startW: img.offsetWidth || (current.attrs.width as number) || MIN_WIDTH,
            startH: img.offsetHeight || (current.attrs.height as number) || MIN_HEIGHT,
            dx,
            dy,
            width: img.offsetWidth,
            height: img.offsetHeight,
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
