import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { defineFeature, useDismissable, useFeatureState, type FeatureRenderContext } from '../../editor'

/** The default palette (Google-Docs-ish) — swap it via `createColorFeature`. */
const DEFAULT_PALETTE = [
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

export interface ColorFeatureOptions {
  /** Preset swatches (any CSS color strings). The "Default" reset and the "+"
   *  native custom picker are always present alongside them. */
  palette?: string[]
}

/**
 * A color swatch that shows the current text color and opens a little popover of
 * preset colors + a "+" that fires the native color picker for a custom one.
 * A `render` toolbar control — every interactive element does
 * `onMouseDown` preventDefault so the editor keeps focus/selection (critical in
 * the bubble menu, so the selection the color applies to survives the click).
 */
function ColorControl({ editor, api, palette }: FeatureRenderContext & { palette: string[] }) {
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
    // The swatch lives in the BUBBLE, which follows the selection anywhere —
    // clamp so the ~190px grid never overflows the right edge of the viewport.
    if (rect) {
      setPos({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 198)),
        top: rect.bottom + 6,
      })
    }
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
                {palette.map((color) => (
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
 * Text color, with a configurable preset palette. TextStyle is the generic
 * style-attribute mark; Color adds the `setColor`/`unsetColor` commands on top
 * of it (both ship in `@tiptap/extension-text-style` in v3). The toolbar
 * control is `group: 'marks'` so it shows in the bubble menu.
 *
 * The palette is COMPOSITION-TIME config, like every feature option: pick it
 * when you build the `features` array. (Editor identity is keyed by feature
 * ids, so swapping to a same-id feature with a different palette at runtime is
 * deliberately ignored — remount with `key` if you truly need that.)
 */
export function createColorFeature({ palette = DEFAULT_PALETTE }: ColorFeatureOptions = {}) {
  return defineFeature({
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
        render: (ctx) => <ColorControl {...ctx} palette={palette} />,
      },
    ],
  })
}

/** Zero-config text color with the default (Docs-ish) palette. */
export const ColorFeature = createColorFeature()
