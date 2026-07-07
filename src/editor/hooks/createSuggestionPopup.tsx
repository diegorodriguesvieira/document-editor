import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { POPUP_CLASS } from '../base.styles'
import { registerEscapeSurface } from './useDismissable'
import {
  useEffect,
  useImperativeHandle,
  useState,
  type ComponentType,
  type Ref,
} from 'react'

/** Imperative handle every suggestion popup exposes so ↑/↓/Enter reach it. */
export interface SuggestionPopupRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface SuggestionPopupConfig<I, S> {
  /** Extension name (also the plugin key, so multiple suggestions coexist). */
  name: string
  /** Trigger character, e.g. '/' or '@'. */
  char: string
  /** A `forwardRef<SuggestionPopupRef, …>` floating list. It receives the raw
   *  suggestion props (query, items, command, …) and forwards the ref. */
  component: ComponentType<SuggestionProps<I, S>>
  items: (props: { query: string; editor: Editor }) => I[]
  command: (props: { editor: Editor; range: Range; props: S }) => void
}

/**
 * The single owner of the `@tiptap/suggestion` + `ReactRenderer` lifecycle:
 * mount a floating popup at the caret, keep it positioned, route keys to it,
 * tear it down. A feature declares only its trigger, filter and command — the
 * `/` command menu and the `@` merge-field menu are both built from this, so
 * fixes (positioning, escape, a11y) land once instead of per trigger.
 */
export function createSuggestionPopup<I = unknown, S = I>(
  config: SuggestionPopupConfig<I, S>,
): Extension {
  return Extension.create({
    name: config.name,
    addProseMirrorPlugins() {
      return [
        Suggestion<I, S>({
          editor: this.editor,
          char: config.char,
          pluginKey: new PluginKey(config.name),
          items: config.items,
          command: config.command,
          render: () => {
            let component: ReactRenderer<SuggestionPopupRef> | null = null
            let popup: HTMLElement | null = null
            let unregisterEscape: (() => void) | null = null

            const place = (clientRect?: (() => DOMRect | null) | null) => {
              const rect = clientRect?.()
              if (!popup || !rect) return
              popup.style.position = 'fixed'
              popup.style.left = `${rect.left}px`
              popup.style.top = `${rect.bottom + 6}px`
              // z-index comes from the .document-editor-popup base rule (it must
              // stack above the fixed footer when the caret sits near it).
            }

            return {
              onStart: (props) => {
                component = new ReactRenderer<SuggestionPopupRef, SuggestionProps<I, S>>(config.component, {
                  props,
                  editor: props.editor,
                })
                popup = document.createElement('div')
                popup.className = `${POPUP_CLASS} suggestion-popup`
                popup.appendChild(component.element)
                document.body.appendChild(popup)
                place(props.clientRect)
                // The popup is now the INNERMOST surface: top the Escape stack
                // so longer-lived useDismissable surfaces (the pinned variables
                // panel, an open page region) don't close in its place while
                // Suggestion handles the actual exit.
                unregisterEscape?.()
                unregisterEscape = registerEscapeSurface()
              },
              onUpdate: (props) => {
                component?.updateProps(props)
                place(props.clientRect)
              },
              onKeyDown: (props) => {
                // Escape must reach the plugin UNhandled: Suggestion owns the
                // exit (onExit + state reset) and SKIPS it when the renderer
                // claims the key — returning true here left the popup open.
                if (props.event.key === 'Escape') return false
                return component?.ref?.onKeyDown({ event: props.event }) ?? false
              },
              onExit: () => {
                unregisterEscape?.()
                unregisterEscape = null
                popup?.remove()
                component?.destroy()
                popup = null
                component = null
              },
            }
          },
        }),
      ]
    },
  })
}

/**
 * ↑/↓ wrap-around navigation + Enter-to-select for a floating list, wired to
 * the popup's imperative `ref`. Returns the highlighted index and a setter (for
 * hover). Resets to the top whenever `items` changes. Shared by every popup.
 */
export function useListKeyboardNav<T>(
  ref: Ref<SuggestionPopupRef>,
  items: readonly T[],
  onSelect: (item: T) => void,
): { index: number; setIndex: (index: number) => void } {
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [items])
  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false
        if (event.key === 'ArrowUp') {
          setIndex((i) => (i + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setIndex((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          const item = items[index]
          if (item) onSelect(item)
          return true
        }
        return false
      },
    }),
    [items, index, onSelect],
  )
  return { index, setIndex }
}
