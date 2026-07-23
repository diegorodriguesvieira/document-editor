import { mergeAttributes } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { defineFeature, type CommandFn, type EditorStateView } from '../../editor'
import { promptOr } from '../promptFallback'
import { icons } from '../icons'
import { renderImageInsertControl } from '../promptForms'

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

/**
 * Left is the DEFAULT: stored as null so an untouched image serializes no
 * attribute at all (same policy as width). An explicit data-align="left" in
 * pasted HTML normalizes to the same canonical null — one representation per
 * alignment; anything unrecognized is dropped, not persisted.
 */
function parseAlign(raw: string | null): 'center' | 'right' | null {
  return raw === 'center' || raw === 'right' ? raw : null
}

function parseDimension(raw: string | null): number | null {
  // Pixels only (bare number or "300px"). parseInt would happily read "80%"
  // or "12em" as 80/12 PIXELS — silently shrinking pasted images.
  const match = raw ? /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(String(raw)) : null
  const value = match ? Number.parseFloat(match[1]) : NaN
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null
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
 * the variable chip — no React needed): 8 handles, corners keep the aspect
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
      align: {
        default: null,
        parseHTML: (element) => parseAlign(element.getAttribute('data-align')),
        renderHTML: (attributes) =>
          attributes.align ? { 'data-align': attributes.align } : {},
      },
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    // Self-contained HTML: size and alignment ship as ONE inline style, so a
    // renderer outside the editor (PDF, e-mail, preview) needs zero CSS of its
    // own. width/height stay as plain attributes too (native browser hints +
    // the parse contract); the style wins over consumer resets like
    // `img { height: auto }`. data-align stays the SEMANTIC source — this is
    // presentation. Longhand margins, not margin-inline: Outlook's Word
    // engine ignores logical properties.
    const { width, height, align } = node.attrs as {
      width: number | null
      height: number | null
      align: 'center' | 'right' | null
    }
    const style = [
      width != null ? `width: ${width}px` : '',
      height != null ? `height: ${height}px` : '',
      align ? 'display: block' : '',
      align ? 'margin-left: auto' : '',
      align === 'center' ? 'margin-right: auto' : '',
    ]
      .filter(Boolean)
      .join('; ')
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, style ? { style } : {})]
  },

  parseHTML() {
    // One src policy, BOTH directions. The base rule has no protocol check
    // (pasted `javascript:` srcs would persist into the backend/PDF HTML
    // contract) and — with allowBase64 off — refuses the `data:` images that
    // image.insert itself accepts, so the feature would emit content its own
    // schema can't re-parse. getAttrs: null accepts the element (the
    // per-attribute parseHTML for src/width/height still runs), false rejects.
    return [
      {
        tag: 'img[src]',
        getAttrs: (element) =>
          isSafeImageSrc(element.getAttribute('src') ?? '') ? null : false,
      },
    ]
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let current = node
      const dom = document.createElement('div')
      dom.className = 'image-resizer'
      // Editable-inert like the variable chip's dom: the wrapper is CHROME
      // (handles + margins), not editable content — left inherited-editable,
      // the browser treats its inside as valid caret territory. setAttribute,
      // not the property: jsdom's property setter doesn't reflect.
      dom.setAttribute('contenteditable', 'false')
      const img = document.createElement('img')
      img.draggable = false // ProseMirror owns block dragging; kill the native ghost

      const sync = (n: typeof node) => {
        if (img.getAttribute('src') !== n.attrs.src) img.setAttribute('src', n.attrs.src as string)
        // Clear removed attrs too — sync runs on every update and must not
        // leave the previous node's alt/title behind.
        if (n.attrs.alt) img.alt = n.attrs.alt as string
        else img.removeAttribute('alt')
        if (n.attrs.title) img.title = n.attrs.title as string
        else img.removeAttribute('title')
        img.style.width = n.attrs.width ? `${n.attrs.width}px` : ''
        img.style.height = n.attrs.height ? `${n.attrs.height}px` : ''
        // Alignment lands on the WRAPPER (the fit-content block the skin
        // margins around), not the <img> — the serialized HTML still carries
        // data-align on the <img> itself via renderHTML.
        if (n.attrs.align) dom.dataset.align = n.attrs.align as string
        else delete dom.dataset.align
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
        scale: number
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
        // Pointer deltas are visual-viewport px while sizes are local CSS px —
        // divide by the captured zoom scale so the edge tracks the cursor.
        const max = dom.parentElement?.clientWidth || Number.POSITIVE_INFINITY
        if (drag.dx !== 0) {
          const next = drag.startW + (drag.dx * (event.clientX - drag.startX)) / drag.scale
          drag.width = Math.round(Math.min(Math.max(next, MIN_WIDTH), max))
          if (drag.dy !== 0) {
            // Corner: proportional — height follows the width's scale.
            drag.height = Math.round((drag.startH * drag.width) / drag.startW)
          }
        }
        if (drag.dx === 0 && drag.dy !== 0) {
          const next = drag.startH + (drag.dy * (event.clientY - drag.startY)) / drag.scale
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
          if (!view.editable) return // read-only: handles are hidden AND inert
          event.preventDefault()
          event.stopPropagation()
          const startW = img.offsetWidth || (current.attrs.width as number) || MIN_WIDTH
          const startH = img.offsetHeight || (current.attrs.height as number) || MIN_HEIGHT
          drag = {
            startX: event.clientX,
            startY: event.clientY,
            startW,
            startH,
            // Effective CSS zoom (page `zoom` prop): rect is zoom-scaled,
            // offsetWidth is not. Captured once — zoom is stable mid-drag.
            // `|| 1` covers both a zero rect (unloaded image) and division
            // fallbacks.
            scale: img.getBoundingClientRect().width / (img.offsetWidth || 1) || 1,
            dx,
            dy,
            // Seed with the same fallbacks: a not-yet-loaded image has zero
            // offsets, and an edge drag writes the untouched axis as-is.
            width: startW,
            height: startH,
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
        // Handles only show while the node is selected (click the image) —
        // and never in read-only, where resizing would mutate the document.
        selectNode() {
          if (!view.editable) return
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

/** Aligning only applies WITH an image selected — a bare updateAttributes on
 *  a text selection would return true having changed nothing. */
const alignImage = (align: 'center' | 'right' | null): CommandFn => (editor) =>
  editor.isActive('image') && editor.chain().focus().updateAttributes('image', { align }).run()

/** Left = canonical null (see {@link parseAlign}), so "left is active" means
 *  "an image with NEITHER of the explicit alignments". */
const alignIs = (state: EditorStateView, align: 'center' | 'right') =>
  state.isActive('image', { align })

/** Image. The command takes an src payload, or prompts as a fallback.
 *
 *  Contributes — insert: "Image" (URL form) · nodeBubble: align left/center/
 *  right · commands: `image.insert`, `image.alignLeft/Center/Right` ·
 *  keymap: Mod-Alt-p. */
export const ImageFeature = defineFeature({
  id: 'image',
  extensions: () => [ResizableImage],
  commands: {
    'image.insert': (editor, payload) => {
      const src = promptOr(payload, 'Image URL:')
      if (!src || !isSafeImageSrc(src)) return false
      return editor.chain().focus().setImage({ src }).run()
    },
    'image.alignLeft': alignImage(null),
    'image.alignCenter': alignImage('center'),
    'image.alignRight': alignImage('right'),
  },
  nodeBubble: [
    {
      id: 'image',
      when: (state) => state.isActive('image'),
      items: [
        {
          id: 'image-align-left',
          group: 'align',
          label: 'Align left',
          icon: icons.alignLeft,
          commandId: 'image.alignLeft',
          isActive: (state) =>
            state.isActive('image') && !alignIs(state, 'center') && !alignIs(state, 'right'),
        },
        {
          id: 'image-align-center',
          group: 'align',
          label: 'Align center',
          icon: icons.alignCenter,
          commandId: 'image.alignCenter',
          isActive: (state) => alignIs(state, 'center'),
        },
        {
          id: 'image-align-right',
          group: 'align',
          label: 'Align right',
          icon: icons.alignRight,
          commandId: 'image.alignRight',
          isActive: (state) => alignIs(state, 'right'),
        },
      ],
    },
  ],
  // Mod-Alt-p ("picture"): Mod-Shift-i collides with Safari's Mail Contents
  // of Page; the Alt+I/J/C/K/U row is devtools territory across browsers.
  keymap: { 'Mod-Alt-p': 'image.insert' },
  insert: [
    {
      id: 'image',
      label: 'Image',
      icon: icons.image,
      commandId: 'image.insert',
      // URL form → exec('image.insert', src); Mod-Alt-p keeps the fallback.
      render: renderImageInsertControl,
    },
  ],
})
