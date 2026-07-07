import { forwardRef } from 'react'
import { useListKeyboardNav, type SuggestionPopupRef } from '../hooks/createSuggestionPopup'
import { SuggestionList } from './SuggestionList'
import type { ToolbarItem } from '../core/types'

interface SlashMenuProps {
  items: ToolbarItem[]
  command: (item: ToolbarItem) => void
}

/**
 * The floating `/` command list: the shared {@link SuggestionList} visuals
 * driven by the shared {@link useListKeyboardNav} (keys arrive through the
 * popup ref — focus never leaves ProseMirror).
 */
export const SlashMenu = forwardRef<SuggestionPopupRef, SlashMenuProps>(function SlashMenu(
  { items, command },
  ref,
) {
  const { index, setIndex } = useListKeyboardNav(ref, items, command)

  return (
    <SuggestionList
      items={items}
      index={index}
      setIndex={setIndex}
      onPick={command}
      ariaLabel="Commands"
      emptyText="No results"
      itemKey={(item) => item.id}
      icon={(item) => item.icon}
      label={(item) => item.label}
    />
  )
})
