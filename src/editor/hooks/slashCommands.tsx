import type { Extension } from '@tiptap/core'
import { SlashMenu } from '../components/SlashMenu'
import { createSuggestionPopup } from './createSuggestionPopup'
import type { ResolvedFeatures } from '../core/registry'
import type { ToolbarItem } from '../core/types'

/**
 * The `/` menu: shows exactly the left insert-rail items (`resolved.inserts`)
 * that run a command, so it stays in sync with the rail. Built from the shared
 * {@link createSuggestionPopup} primitive — only the filter and command differ.
 */
export function createSlashCommands(resolved: ResolvedFeatures): Extension {
  return createSuggestionPopup<ToolbarItem, ToolbarItem>({
    name: 'slashCommands',
    char: '/',
    component: SlashMenu,
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
  })
}
