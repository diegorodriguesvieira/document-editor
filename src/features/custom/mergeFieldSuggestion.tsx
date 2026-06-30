import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { useDocumentVariables, type DocumentVariable } from './documentVariables'

export interface MergeFieldMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

/**
 * Floating list shown while typing `@…`. Reads the (consumer-provided)
 * variables from context and filters them by the typed query — so it stays in
 * sync with async-loaded variables without rebuilding the editor. Reuses the
 * `.slash-menu` look (same floating-list primitive).
 */
export const MergeFieldMenu = forwardRef<
  MergeFieldMenuRef,
  { query: string; onPick: (variable: DocumentVariable) => void }
>(function MergeFieldMenu({ query, onPick }, ref) {
  const variables = useDocumentVariables()
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return variables
    // "starts with" the typed text, matched against any word of the label.
    return variables.filter((variable) =>
      variable.label
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(q)),
    )
  }, [variables, query])

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
          if (item) onPick(item)
          return true
        }
        return false
      },
    }),
    [items, index, onPick],
  )

  if (items.length === 0) {
    return <div className="slash-menu slash-menu--empty">No variables found</div>
  }

  return (
    <div className="slash-menu" role="listbox" aria-label="Variables">
      {items.map((variable, i) => (
        <button
          key={variable.id}
          type="button"
          role="option"
          aria-selected={i === index}
          className="slash-menu__item"
          data-active={i === index}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(variable)
          }}
        >
          <span className="slash-menu__icon">@</span>
          {variable.label}
        </button>
      ))}
    </div>
  )
})

/**
 * React-coupled `@` trigger: typing `@` opens {@link MergeFieldMenu}; picking a
 * variable replaces the `@query` with an inline merge-field chip (+ a trailing
 * space). Lives in the merge-field feature's extensions.
 */
export function createMergeFieldSuggestion(): Extension {
  return Extension.create({
    name: 'mergeFieldSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<DocumentVariable, DocumentVariable>({
          editor: this.editor,
          char: '@',
          // Distinct key so it coexists with the `/` suggestion plugin.
          pluginKey: new PluginKey('mergeFieldSuggestion'),
          // The popup owns filtering (it reads variables from context), so the
          // plugin's own item list is unused.
          items: () => [],
          command: ({ editor, range, props }) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent([
                { type: 'mergeField', attrs: { id: props.id, label: props.label } },
                // Trailing space so the cursor isn't glued to the chip.
                { type: 'text', text: ' ' },
              ])
              .run()
          },
          render: () => {
            let component: ReactRenderer<MergeFieldMenuRef> | null = null
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
                component = new ReactRenderer(MergeFieldMenu, {
                  props: { query: props.query, onPick: props.command },
                  editor: props.editor,
                })
                popup = document.createElement('div')
                popup.appendChild(component.element)
                document.body.appendChild(popup)
                place(props.clientRect)
              },
              onUpdate: (props) => {
                component?.updateProps({ query: props.query, onPick: props.command })
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
