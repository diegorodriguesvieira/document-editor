import { useRef, useState } from 'react'
import IconButton from '@mui/material/IconButton'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { defineFeature, PopupShell, useFeatureState, type FeatureRenderContext } from '../../editor'
import { popupTriggerProps } from '../promptForms'

/** The default palette (Google-Docs-ish) — swap it via `createColorFeature`.
 *  Also the swatch set of the table context menu's cell-background picker. */
export const DEFAULT_PALETTE = [
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
 * Payload gate for colors that land in a `style` attribute of the backend/PDF
 * HTML contract (`color.set`, `table.setCellBackground`). The regex is the
 * injection gate (no declaration smuggling); CSS.supports refines it in real
 * browsers (jsdom lacks it).
 */
export function isSafeCssColor(color: string): boolean {
  if (!color || /[;{}<>]/.test(color)) return false
  if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('color', color)) {
    return false
  }
  return true
}

/**
 * A color swatch that shows the current text color and opens a little popover of
 * preset colors + a "+" that fires the native color picker for a custom one.
 * A `render` bubble control — every interactive element does
 * `onMouseDown` preventDefault so the editor keeps focus/selection (critical in
 * the bubble menu, so the selection the color applies to survives the click).
 */
function ColorControl({ editor, api, palette }: FeatureRenderContext & { palette: string[] }) {
  const current = useFeatureState(
    editor,
    (ed) => (ed.getAttributes('textStyle').color as string | undefined) ?? null,
  )
  const [open, setOpen] = useState(false)
  const swatchRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const set = (color: string) => {
    api.exec('color.set', color)
    setOpen(false)
  }

  return (
    <>
      <IconButton
        ref={swatchRef}
        className="color-swatch"
        {...popupTriggerProps('Text color', open, () => setOpen((value) => !value), 'menu')}
      >
        <span className="color-swatch__dot" style={{ backgroundColor: current ?? '#000000' }} />
      </IconButton>

      <PopupShell
        anchorEl={swatchRef.current}
        open={open}
        onClose={() => setOpen(false)}
        surfaceClassName="color-picker"
        role="menu"
        ariaLabel="Text color"
        popperProps={{ onMouseDown: (event) => event.preventDefault() }}
        paperProps={{ sx: { p: 1.5 } }}
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
      </PopupShell>
    </>
  )
}

/**
 * Text color, with a configurable preset palette. TextStyle is the generic
 * style-attribute mark; Color adds the `setColor`/`unsetColor` commands on top
 * of it (both ship in `@tiptap/extension-text-style` in v3). The bubble
 * control is `group: 'marks'` so it shows in the bubble menu.
 *
 * The palette is COMPOSITION-TIME config, like every feature option: pick it
 * when you build the `features` array. (Editor identity is keyed by feature
 * ids, so swapping to a same-id feature with a different palette at runtime is
 * deliberately ignored — remount with `key` if you truly need that.)
 *
 * Contributes — bubble: color swatch (custom control, group `marks`) ·
 * commands: `color.set`/`color.unset`.
 */
export function createColorFeature({ palette = DEFAULT_PALETTE }: ColorFeatureOptions = {}) {
  return defineFeature({
    id: 'color',
    extensions: () => [TextStyle, Color],
    commands: {
      'color.set': (editor, payload) => {
        // The value lands in a style attribute (`color: <value>`) of the
        // backend/PDF HTML contract — validate like every payload sibling
        // (image.insert).
        const color = typeof payload === 'string' ? payload.trim() : ''
        if (!isSafeCssColor(color)) return false
        return editor.chain().focus().setColor(color).run()
      },
      'color.unset': (editor) => editor.chain().focus().unsetColor().run(),
    },
    bubble: [
      {
        id: 'color',
        group: 'marks',
        label: 'Text color',
        render: (ctx) => <ColorControl {...ctx} palette={palette} />,
      },
    ],
  })
}

/** Zero-config text color with the default (Docs-ish) palette.
 *
 *  Contributes — bubble: color swatch (custom control) · commands:
 *  `color.set`/`color.unset`. */
export const ColorFeature = createColorFeature()
