import type { ReactNode } from 'react'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'

/**
 * The floating caret-popup LISTBOX both suggestion menus render (`/` commands
 * and `@` variables) — the presentational third of the suggestion kit, next
 * to `createSuggestionPopup` + `useListKeyboardNav` (which the wrapper
 * components keep, along with their own filtering). Deliberately NOT a
 * focusing MUI Menu: focus must stay in ProseMirror so typing keeps
 * filtering; highlight state arrives via `index`/`setIndex`.
 */
export function SuggestionList<T>({
  items,
  index,
  setIndex,
  onPick,
  ariaLabel,
  emptyText,
  itemKey,
  icon,
  label,
}: {
  items: readonly T[]
  index: number
  setIndex: (index: number) => void
  onPick: (item: T) => void
  ariaLabel: string
  emptyText: string
  itemKey: (item: T) => string
  /** Optional icon per item — the chip span renders only when non-nullish. */
  icon?: (item: T) => ReactNode
  label: (item: T) => ReactNode
}) {
  if (items.length === 0) {
    return <Paper className="slash-menu slash-menu--empty">{emptyText}</Paper>
  }

  return (
    <Paper className="slash-menu" role="listbox" aria-label={ariaLabel}>
      {items.map((item, i) => {
        const iconNode = icon?.(item)
        return (
          <MenuItem
            key={itemKey(item)}
            component="div"
            role="option"
            aria-selected={i === index}
            selected={i === index}
            className="slash-menu__item"
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(event) => {
              // preventDefault keeps the editor focused; run on mousedown so
              // the pick lands before anything can blur/reposition the popup.
              event.preventDefault()
              onPick(item)
            }}
          >
            {iconNode != null ? <span className="slash-menu__icon">{iconNode}</span> : null}
            {label(item)}
          </MenuItem>
        )
      })}
    </Paper>
  )
}
