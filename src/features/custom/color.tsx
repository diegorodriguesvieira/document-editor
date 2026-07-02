import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { defineFeature, useDismissable, useFeatureState, type FeatureRenderContext } from '../../editor'

/** Preset palette (Google-Docs-ish). Just data — swap freely. */
const PRESETS = [
  '#000000',
  '#5f6368',
  '#d93025',
  '#e8710a',
  '#f9ab00',
  '#188038',
  '#1a73e8',
  '#9334e6',
  '#e52592',
  '#795548',
]

/**
 * A color swatch that shows the current text color and opens a little popover of
 * preset colors + a "+" that fires the native color picker for a custom one.
 * A `render` toolbar control — every interactive element does
 * `onMouseDown` preventDefault so the editor keeps focus/selection (critical in
 * the bubble menu, so the selection the color applies to survives the click).
 */
function ColorControl({ editor, api }: FeatureRenderContext) {
  const current = useFeatureState(
    editor,
    (ed) => (ed.getAttributes('textStyle').color as string | undefined) ?? null,
  )
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const swatchRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The swatch counts as "inside" so toggling it doesn't insta-reopen. Fixed
  // coordinates → close on scroll/resize too (the anchor drifts away).
  useDismissable([popoverRef, swatchRef], () => setOpen(false), {
    enabled: open,
    closeOnScroll: true,
  })

  const toggle = () => {
    const rect = swatchRef.current?.getBoundingClientRect()
    if (rect) setPos({ left: rect.left, top: rect.bottom + 6 })
    setOpen((value) => !value)
  }

  const set = (color: string) => {
    api.exec('color.set', color)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={swatchRef}
        type="button"
        className="color-swatch"
        title="Text color"
        aria-label="Text color"
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
      >
        <span className="color-swatch__dot" style={{ backgroundColor: current ?? '#000000' }} />
      </button>

      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="document-editor-popup color-picker"
              role="menu"
              aria-label="Text color"
              // z-index lives in the stylesheet (--editor-z-popup) so consumers can re-stack.
              style={{ position: 'fixed', left: pos.left, top: pos.top }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <div className="color-picker__grid">
                <button
                  type="button"
                  className="color-picker__swatch color-picker__default"
                  title="Default"
                  aria-label="Default color"
                  data-active={current == null}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    api.exec('color.unset')
                    setOpen(false)
                  }}
                >
                  A
                </button>
                {PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="color-picker__swatch"
                    title={color}
                    aria-label={color}
                    data-active={current?.toLowerCase() === color.toLowerCase()}
                    style={{ backgroundColor: color }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => set(color)}
                  />
                ))}
                <button
                  type="button"
                  className="color-picker__swatch color-picker__custom"
                  title="Custom color"
                  aria-label="Custom color"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => inputRef.current?.click()}
                >
                  +
                </button>
              </div>
              {/* Hidden native picker — the "+" triggers it; live-applies on change. */}
              <input
                ref={inputRef}
                type="color"
                className="color-picker__input"
                defaultValue={current ?? '#000000'}
                onChange={(event) => api.exec('color.set', event.target.value)}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * Text color. TextStyle is the generic style-attribute mark; Color adds the
 * `setColor`/`unsetColor` commands on top of it (both ship in
 * `@tiptap/extension-text-style` in v3). The toolbar control is `group: 'marks'`
 * so it shows in the formatting toolbar AND the bubble menu.
 */
export const ColorFeature = defineFeature({
  id: 'color',
  extensions: () => [TextStyle, Color],
  commands: {
    'color.set': (editor, payload) => editor.chain().focus().setColor(payload as string).run(),
    'color.unset': (editor) => editor.chain().focus().unsetColor().run(),
  },
  toolbar: [
    {
      id: 'color',
      group: 'marks',
      label: 'Text color',
      render: (ctx) => <ColorControl {...ctx} />,
    },
  ],
})
