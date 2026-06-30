import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { SlashMenu, type SlashMenuRef } from '../components/SlashMenu'
import type { ResolvedFeatures } from '../core/registry'
import type { ToolbarItem } from '../core/types'

/**
 * Synthetic extension (built from `resolved`): the `/` menu. It shows exactly
 * the left insert-rail items (`resolved.inserts`) that run a command — so it's
 * always in sync with the rail: remove an insert and it disappears from `/` too.
 * React-coupled (ReactRenderer) so it lives in the React layer — headless
 * `createEditor` doesn't include it.
 */
export function createSlashCommands(resolved: ResolvedFeatures): Extension {
  return Extension.create({
    name: 'slashCommands',
    addProseMirrorPlugins() {
      return [
        Suggestion<ToolbarItem, ToolbarItem>({
          editor: this.editor,
          char: '/',
          startOfLine: false,
          items: ({ query }) => {
            const q = query.toLowerCase()
            return resolved.inserts.filter(
              (item) => item.commandId != null && item.label.toLowerCase().includes(q),
            )
          },
          command: ({ editor, range, props }) => {
            // Remove the "/query", then run the picked insert command where it was.
            editor.chain().focus().deleteRange(range).run()
            const commandId = props.commandId
            if (commandId) resolved.commands[commandId]?.(editor)
          },
          render: () => {
            let component: ReactRenderer<SlashMenuRef> | null = null
            let popup: HTMLElement | null = null

            const place = (clientRect?: (() => DOMRect | null) | null) => {
              const rect = clientRect?.()
              if (!popup || !rect) return
              popup.style.position = 'fixed'
              popup.style.left = `${rect.left}px`
              popup.style.top = `${rect.bottom + 6}px`
              popup.style.zIndex = '1000'
            }

            return {
              onStart: (props) => {
                component = new ReactRenderer(SlashMenu, {
                  props: { items: props.items, command: props.command },
                  editor: props.editor,
                })
                popup = document.createElement('div')
                popup.appendChild(component.element)
                document.body.appendChild(popup)
                place(props.clientRect)
              },
              onUpdate: (props) => {
                component?.updateProps({ items: props.items, command: props.command })
                place(props.clientRect)
              },
              onKeyDown: (props) => {
                if (props.event.key === 'Escape') return true
                return component?.ref?.onKeyDown({ event: props.event }) ?? false
              },
              onExit: () => {
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
