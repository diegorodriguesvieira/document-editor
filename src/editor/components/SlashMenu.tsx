import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { ToolbarItem } from '../core/types'

export interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface SlashMenuProps {
  items: ToolbarItem[]
  command: (item: ToolbarItem) => void
}

/**
 * The floating `/` command list. Keyboard nav (↑/↓/Enter) is driven by the
 * Suggestion plugin via the imperative `onKeyDown` (exposed through the ref).
 */
export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(function SlashMenu(
  { items, command },
  ref,
) {
  const [index, setIndex] = useState(0)

  // Reset the highlight whenever the filtered list changes.
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
          if (item) command(item)
          return true
        }
        return false
      },
    }),
    [items, index, command],
  )

  if (items.length === 0) {
    return <div className="slash-menu slash-menu--empty">Nada encontrado</div>
  }

  return (
    <div className="slash-menu" role="listbox" aria-label="Comandos">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={i === index}
          className="slash-menu__item"
          data-active={i === index}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(event) => {
            event.preventDefault()
            command(item)
          }}
        >
          {item.icon ? <span className="slash-menu__icon">{item.icon}</span> : null}
          {item.label}
        </button>
      ))}
    </div>
  )
})
