import { fireEvent } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vitest'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { DecorationSet } from '@tiptap/pm/view'
import { jsonFindNode, jsonHasNode, renderEditor } from '../../test/editorHarness'
import { ImageFeature } from './image'

describe('image src safety', () => {
  it('inserts an http(s) image', () => {
    const { api } = renderEditor([ImageFeature])
    expect(api.exec('image.insert', 'https://example.com/a.png')).toBe(true)
    expect(jsonHasNode(api.getJSON().doc, 'image')).toBe(true)
  })

  it('allows data: URLs', () => {
    const { api } = renderEditor([ImageFeature])
    expect(api.exec('image.insert', 'data:image/png;base64,iVBOR')).toBe(true)
  })

  it('rejects javascript: and other script protocols', () => {
    const { api } = renderEditor([ImageFeature])
    expect(api.exec('image.insert', 'javascript:alert(1)')).toBe(false)
    expect(api.exec('image.insert', 'vbscript:msgbox')).toBe(false)
    expect(jsonHasNode(api.getJSON().doc, 'image')).toBe(false)
  })

  it('pasted HTML cannot smuggle a script-URL src — the PARSE rule enforces the same policy as image.insert', () => {
    // The command guard alone is not enough: without a parseHTML override the
    // base rule persisted `javascript:` srcs straight into the backend/PDF
    // HTML contract (the exact threat isSafeImageSrc documents).
    const { editor, api } = renderEditor([ImageFeature])
    // The paste pipeline's parse rules (jsdom has no ClipboardEvent — parse
    // with the schema's DOMParser, exactly what paste runs) drop it silently…
    const pasteParse = (html: string) => {
      const el = document.createElement('div')
      el.innerHTML = html
      return JSON.stringify(PMDOMParser.fromSchema(editor.schema).parse(el).toJSON())
    }
    expect(pasteParse('<img src="javascript:alert(1)">')).not.toContain('image')
    expect(pasteParse('<img src="vbscript:msgbox">')).not.toContain('javascript:')
    // …while the programmatic path refuses LOUDLY (content check, no silent wipe).
    expect(() => editor.commands.insertContent('<img src="javascript:alert(1)">')).toThrow()
    expect(jsonHasNode(api.getJSON().doc, 'image')).toBe(false)
  })

  it('data: images survive the round trip — the schema must re-parse what image.insert emits', () => {
    const src = 'data:image/png;base64,iVBOR'
    // Paste path (the base rule, allowBase64: false, used to REFUSE these).
    const pasted = renderEditor([ImageFeature])
    pasted.editor.commands.insertContent(`<img src="${src}">`)
    const image = jsonFindNode(pasted.api.getJSON().doc, 'image')
    expect(image?.attrs?.src).toBe(src)

    // Copy/paste of the feature's own serialized HTML.
    const source = renderEditor([ImageFeature])
    source.api.exec('image.insert', src)
    const reloaded = renderEditor([ImageFeature])
    reloaded.editor.commands.insertContent(source.api.getHTML())
    expect(jsonHasNode(reloaded.api.getJSON().doc, 'image')).toBe(true)
  })
})

describe('image resize (width attribute)', () => {
  it('round-trips width: attr → HTML `width` → parsed back', () => {
    const created = renderEditor([ImageFeature])
    created.api.exec('image.insert', 'https://example.com/a.png')
    created.editor.commands.updateAttributes('image', { width: 400 })

    expect(created.api.getHTML()).toContain('width="400"')

    const reloaded = renderEditor([ImageFeature])
    reloaded.api.setJSON(created.api.getJSON())
    const image = jsonFindNode(reloaded.api.getJSON().doc, 'image')
    expect(image?.attrs?.width).toBe(400)
  })

  it('parses width from pasted HTML (attribute or inline style)', () => {
    const created = renderEditor([ImageFeature])
    created.editor.commands.insertContent('<img src="https://example.com/a.png" width="300">')
    let image = jsonFindNode(created.api.getJSON().doc, 'image')
    expect(image?.attrs?.width).toBe(300)

    const other = renderEditor([ImageFeature])
    other.editor.commands.insertContent('<img src="https://example.com/b.png" style="width: 250px">')
    image = jsonFindNode(other.api.getJSON().doc, 'image')
    expect(image?.attrs?.width).toBe(250)
  })

  it('ignores NON-pixel CSS widths on paste — "80%" is not 80 pixels', () => {
    const widthFor = (style: string) => {
      const created = renderEditor([ImageFeature])
      created.editor.commands.insertContent(`<img src="https://example.com/a.png" style="width: ${style}">`)
      return jsonFindNode(created.api.getJSON().doc, 'image')?.attrs?.width
    }
    expect(widthFor('80%')).toBeNull()
    expect(widthFor('12em')).toBeNull()
    expect(widthFor('40vw')).toBeNull()
  })

  it('images without width stay width-less (no serialized attr, no style)', () => {
    const created = renderEditor([ImageFeature])
    created.api.exec('image.insert', 'https://example.com/a.png')
    expect(created.api.getHTML()).not.toContain('width=')
    expect(created.api.getHTML()).not.toContain('style=')
  })

  it('round-trips height (edge-handle stretch persists both dimensions)', () => {
    const created = renderEditor([ImageFeature])
    created.api.exec('image.insert', 'https://example.com/a.png')
    created.editor.commands.updateAttributes('image', { width: 400, height: 250 })

    const html = created.api.getHTML()
    expect(html).toContain('width="400"')
    expect(html).toContain('height="250"')

    const reloaded = renderEditor([ImageFeature])
    reloaded.api.setJSON(created.api.getJSON())
    const image = jsonFindNode(reloaded.api.getJSON().doc, 'image')
    expect(image?.attrs?.height).toBe(250)
  })
})

describe('image alignment (data-align attribute)', () => {
  /** An editor with a selected image (align commands act on the selection). */
  function selectedImage(attrs: Record<string, unknown> = {}) {
    const created = renderEditor([ImageFeature], {
      content: {
        doc: {
          type: 'doc',
          content: [
            { type: 'image', attrs: { src: 'https://example.com/a.png', ...attrs } },
            { type: 'paragraph' },
          ],
        },
      },
    })
    created.editor.commands.setNodeSelection(0)
    const align = () => jsonFindNode(created.api.getJSON().doc, 'image')?.attrs?.align
    return { created, align }
  }

  it('center/right write the attr and serialize data-align in the HTML contract', () => {
    const { created, align } = selectedImage()
    expect(created.api.exec('image.alignCenter')).toBe(true)
    expect(align()).toBe('center')
    expect(created.api.getHTML()).toContain('data-align="center"')

    expect(created.api.exec('image.alignRight')).toBe(true)
    expect(align()).toBe('right')
    expect(created.api.getHTML()).toContain('data-align="right"')
  })

  it('left is the canonical DEFAULT — it clears the attr instead of writing "left"', () => {
    const { created, align } = selectedImage({ align: 'center' })
    expect(created.api.exec('image.alignLeft')).toBe(true)
    expect(align()).toBeNull()
    expect(created.api.getHTML()).not.toContain('data-align')
    expect(created.api.getHTML()).not.toContain('style=') // no leftover margins either
  })

  it('serialized HTML is SELF-CONTAINED — size + alignment ship as ONE inline style, zero consumer CSS', () => {
    const { created } = selectedImage()
    created.editor.commands.updateAttributes('image', { width: 400, height: 250 })
    created.api.exec('image.alignCenter')
    expect(created.api.getHTML()).toContain(
      'style="width: 400px; height: 250px; display: block; margin-left: auto; margin-right: auto;"',
    )

    // Right alignment pushes with a lone margin-left (longhand, not
    // margin-inline — Outlook's Word engine ignores logical properties).
    created.api.exec('image.alignRight')
    expect(created.api.getHTML()).toContain(
      'style="width: 400px; height: 250px; display: block; margin-left: auto;"',
    )

    // And the schema re-parses its own self-contained output intact.
    const reloaded = renderEditor([ImageFeature])
    reloaded.editor.commands.insertContent(created.api.getHTML())
    expect(jsonFindNode(reloaded.api.getJSON().doc, 'image')?.attrs).toMatchObject({
      width: 400,
      height: 250,
      align: 'right',
    })
  })

  it('refuses to align without an image selected (no silent true on a text selection)', () => {
    const { created } = selectedImage()
    created.editor.commands.setTextSelection(3) // caret in the paragraph
    expect(created.api.exec('image.alignCenter')).toBe(false)
  })

  it('parses data-align from pasted HTML — and normalizes "left"/unknown values to null', () => {
    const alignFor = (value: string) => {
      const created = renderEditor([ImageFeature])
      created.editor.commands.insertContent(
        `<img src="https://example.com/a.png" data-align="${value}">`,
      )
      return jsonFindNode(created.api.getJSON().doc, 'image')?.attrs?.align
    }
    expect(alignFor('right')).toBe('right')
    expect(alignFor('center')).toBe('center')
    expect(alignFor('left')).toBeNull() // one representation per alignment
    expect(alignFor('top')).toBeNull() // unrecognized values are dropped
  })

  it('mirrors the attr onto the node view WRAPPER (the skin margins it), and clears it', () => {
    const { created } = selectedImage()
    const resizer = created.editor.view.dom.querySelector('.image-resizer') as HTMLElement

    created.api.exec('image.alignCenter')
    expect(resizer.dataset.align).toBe('center')

    created.api.exec('image.alignLeft')
    expect(resizer.dataset.align).toBeUndefined()
  })

  it('round-trips through JSON persistence', () => {
    const { created } = selectedImage()
    created.api.exec('image.alignRight')

    const reloaded = renderEditor([ImageFeature])
    reloaded.api.setJSON(created.api.getJSON())
    expect(jsonFindNode(reloaded.api.getJSON().doc, 'image')?.attrs?.align).toBe('right')
  })
})

describe('image resize interaction (dragging the handles)', () => {
  /** An editor whose first node is an image, with the node view mounted. jsdom
   *  has no layout, so the <img> gets the offset size its attrs imply — the
   *  same numbers the node view reads at drag start. */
  function mountImage(attrs: Record<string, unknown> = {}) {
    const created = renderEditor([ImageFeature], {
      content: {
        doc: {
          type: 'doc',
          content: [
            { type: 'image', attrs: { src: 'https://example.com/a.png', ...attrs } },
            // Explicit — TrailingNode only appends it on the first transaction,
            // and the selection tests need a text position from the start.
            { type: 'paragraph' },
          ],
        },
      },
    })
    const resizer = created.editor.view.dom.querySelector('.image-resizer') as HTMLElement
    const img = resizer.querySelector('img') as HTMLImageElement
    // The node view mirrors the attrs into style.width/height (sync). Deriving
    // the offsets from that style keeps them honest ACROSS gestures — a static
    // number would go stale after the first resize.
    Object.defineProperty(img, 'offsetWidth', {
      get: () => Number.parseInt(img.style.width, 10) || 0,
      configurable: true,
    })
    Object.defineProperty(img, 'offsetHeight', {
      get: () => Number.parseInt(img.style.height, 10) || 0,
      configurable: true,
    })
    const handle = (id: string) =>
      resizer.querySelector(`.image-resizer__handle--${id}`) as HTMLElement
    const drag = (id: string, to: { x: number; y: number }) => {
      fireEvent.mouseDown(handle(id), { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: to.x, clientY: to.y })
      fireEvent.mouseUp(document)
    }
    const imageAttrs = () =>
      jsonFindNode(created.api.getJSON().doc, 'image')?.attrs
    return { created, resizer, img, handle, drag, imageAttrs }
  }

  it('renders all 8 handles around the image', () => {
    const { resizer } = mountImage({ width: 200, height: 100 })
    expect(resizer.querySelectorAll('.image-resizer__handle')).toHaveLength(8)
  })

  it('keeps the wrapper editable-inert (chrome, not caret territory)', () => {
    const { resizer } = mountImage({ width: 200, height: 100 })
    expect(resizer.getAttribute('contenteditable')).toBe('false')
  })

  it('edge handle stretches ONE dimension and freezes the other at its current pixels', () => {
    const { drag, imageAttrs } = mountImage({ width: 200, height: 100 })
    // Right edge, +50px: width follows the pointer, height is written as-is
    // (the deliberate Docs-style distortion) instead of staying proportional.
    drag('e', { x: 50, y: 999 }) // y must be ignored by a horizontal handle
    expect(imageAttrs()).toMatchObject({ width: 250, height: 100 })
  })

  it('vertical edge handle drives height only (and left/top handles invert the axis)', () => {
    const { drag, imageAttrs } = mountImage({ width: 200, height: 100 })
    drag('s', { x: 999, y: 60 }) // bottom edge, +60px
    expect(imageAttrs()).toMatchObject({ width: 200, height: 160 })
    drag('w', { x: 50, y: 0 }) // left edge: dragging right (+50) SHRINKS width
    expect(imageAttrs()).toMatchObject({ width: 150, height: 160 })
  })

  it('divides pointer deltas by the page zoom — the edge tracks the cursor at any scale', () => {
    // Pointer deltas are visual-viewport px; offset sizes are local CSS px.
    // At zoom 2 the rect is twice the offset width: 100 screen px = 50 CSS px.
    const zoomed = mountImage({ width: 200, height: 100 })
    zoomed.img.getBoundingClientRect = () =>
      ({ width: zoomed.img.offsetWidth * 2 } as DOMRect)
    zoomed.drag('e', { x: 100, y: 0 })
    expect(zoomed.imageAttrs()).toMatchObject({ width: 250 })

    // Zoom OUT (0.5): 50 screen px = 100 CSS px.
    const shrunk = mountImage({ width: 200, height: 100 })
    shrunk.img.getBoundingClientRect = () =>
      ({ width: shrunk.img.offsetWidth * 0.5 } as DOMRect)
    shrunk.drag('e', { x: 50, y: 0 })
    expect(shrunk.imageAttrs()).toMatchObject({ width: 300 })
  })

  it('corner handle keeps the aspect ratio', () => {
    const { drag, imageAttrs } = mountImage({ width: 200, height: 100 })
    drag('se', { x: 100, y: 0 }) // width 200 → 300; height follows the scale
    expect(imageAttrs()).toMatchObject({ width: 300, height: 150 })
  })

  it('corner resize on a never-stretched image keeps it natural-ratio (no height written)', () => {
    const { drag, imageAttrs } = mountImage({ width: 200 })
    drag('se', { x: 100, y: 0 })
    // Width is persisted; height stays null so the image keeps height:auto.
    expect(imageAttrs()?.width).toBe(300)
    expect(imageAttrs()?.height).toBeNull()
  })

  it('clamps the width at the minimum — a drag past zero cannot invert the image', () => {
    const { drag, imageAttrs } = mountImage({ width: 200, height: 100 })
    drag('e', { x: -1000, y: 0 })
    expect(imageAttrs()?.width).toBe(60) // MIN_WIDTH
  })

  it('live feedback is style-only — the document is written ONCE, on mouseup', () => {
    const { created, img, handle, imageAttrs } = mountImage({ width: 200, height: 100 })
    let updates = 0
    created.editor.on('update', () => {
      updates += 1
    })

    fireEvent.mouseDown(handle('e'), { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 20, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 50, clientY: 0 })

    // Mid-drag: the <img> previews the size, the document hasn't moved.
    expect(img.style.width).toBe('250px')
    expect(imageAttrs()?.width).toBe(200)
    expect(updates).toBe(0)

    fireEvent.mouseUp(document)
    expect(imageAttrs()?.width).toBe(250)
    expect(updates).toBe(1) // a single clean undo step per gesture
  })

  it('a click on a handle without movement writes nothing (no undo noise)', () => {
    const { created, handle } = mountImage({ width: 200, height: 100 })
    const before = created.editor.state

    fireEvent.mouseDown(handle('se'), { clientX: 10, clientY: 10 })
    fireEvent.mouseUp(document)

    // No transaction at all — the state object is the same reference.
    expect(created.editor.state).toBe(before)
  })

  it('shows the handles only while the node is selected (select/deselect classes)', () => {
    const { created, resizer } = mountImage({ width: 200, height: 100 })
    // The doc starts at the image, so PM's initial selection IS the node —
    // park the caret in the trailing paragraph first.
    created.editor.commands.setTextSelection(2)
    expect(resizer.classList.contains('image-resizer--selected')).toBe(false)

    created.editor.commands.setNodeSelection(0)
    expect(resizer.classList.contains('image-resizer--selected')).toBe(true)

    created.editor.commands.setTextSelection(2)
    expect(resizer.classList.contains('image-resizer--selected')).toBe(false)
  })

  it('stopEvent keeps ProseMirror out of HANDLE drags only — the image itself stays PM territory', () => {
    const { created } = mountImage({ width: 200, height: 100 })
    const view = created.editor.view
    // Build a detached instance through the same factory PM uses, so we can
    // call its stopEvent directly.
    const construct = view.someProp('nodeViews')?.image
    expect(construct).toBeDefined()
    const nodeView = construct!(created.editor.state.doc.firstChild!, view, () => 0, [], DecorationSet.empty)
    const dom = nodeView.dom as HTMLElement

    const at = (target: Element | null) => {
      const event = new MouseEvent('mousedown')
      Object.defineProperty(event, 'target', { value: target })
      return nodeView.stopEvent!(event)
    }
    expect(at(dom.querySelector('.image-resizer__handle--e'))).toBe(true)
    expect(at(dom.querySelector('img'))).toBe(false)
    nodeView.destroy?.()
  })

  it('an unloaded image (zero offsets) still writes real dimensions on an edge drag', () => {
    // NO offset stubs here: jsdom's offsetWidth/Height are 0, exactly like an
    // <img> whose file has not loaded yet. The drag seeds must fall back to
    // the attrs — otherwise the untouched axis is written as 0.
    const created = renderEditor([ImageFeature], {
      content: {
        doc: {
          type: 'doc',
          content: [
            { type: 'image', attrs: { src: 'https://example.com/a.png', width: 200, height: 100 } },
            { type: 'paragraph' },
          ],
        },
      },
    })
    const resizer = created.editor.view.dom.querySelector('.image-resizer') as HTMLElement
    fireEvent.mouseDown(resizer.querySelector('.image-resizer__handle--s')!, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 0, clientY: 60 })
    fireEvent.mouseUp(document)

    const attrs = jsonFindNode(created.api.getJSON().doc, 'image')?.attrs
    expect(attrs).toMatchObject({ width: 200, height: 160 }) // width NOT zeroed
  })

  it('clears alt/title from the DOM when the attrs are removed (sync must not leave leftovers)', () => {
    const { created, img } = mountImage({ width: 200, height: 100 })
    created.editor.commands.setNodeSelection(0) // updateAttributes targets the selection
    created.editor.commands.updateAttributes('image', { alt: 'legenda', title: 'dica' })
    expect(img.getAttribute('alt')).toBe('legenda')
    expect(img.getAttribute('title')).toBe('dica')

    created.editor.commands.updateAttributes('image', { alt: null, title: null })
    expect(img.hasAttribute('alt')).toBe(false)
    expect(img.hasAttribute('title')).toBe(false)
  })

  it('destroy removes the document-level drag listeners (no zombie handlers mid-drag)', () => {
    const { created, handle } = mountImage({ width: 200, height: 100 })
    fireEvent.mouseDown(handle('e'), { clientX: 0, clientY: 0 }) // listeners attached

    const removed = vi.spyOn(document, 'removeEventListener')
    created.editor.destroy()
    const names = removed.mock.calls.map(([name]) => name)
    expect(names).toContain('mousemove')
    expect(names).toContain('mouseup')
    removed.mockRestore()

    // The gesture continuing after destroy must be inert, not a crash.
    fireEvent.mouseMove(document, { clientX: 400, clientY: 0 })
    fireEvent.mouseUp(document)
  })
})
