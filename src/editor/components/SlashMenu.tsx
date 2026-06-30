import { forwardRef } from 'react'
import { useListKeyboardNav, type SuggestionPopupRef } from '../hooks/createSuggestionPopup'
import type { ToolbarItem } from '../core/types'

/** @deprecated alias — use {@link SuggestionPopupRef}. */
export type SlashMenuRef = SuggestionPopupRef

interface SlashMenuProps {
  items: ToolbarItem[]
  command: (item: ToolbarItem) => void
}

/**
 * The floating `/` command list. Navigation is driven by the shared
 * {@link useListKeyboardNav} (exposed through the popup ref).
 */
export const SlashMenu = forwardRef<SuggestionPopupRef, SlashMenuProps>(function SlashMenu(
  { items, command },
  ref,
) {
  const { index, setIndex } = useListKeyboardNav(ref, items, command)

  if (items.length === 0) {
    return <div className="slash-menu slash-menu--empty">No results</div>
  }

  return (
    <div className="slash-menu" role="listbox" aria-label="Commands">
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
