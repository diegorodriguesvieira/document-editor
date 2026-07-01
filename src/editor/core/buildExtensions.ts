import { Extension } from '@tiptap/core'
import type { AnyExtension } from '@tiptap/core'
import { Document as DocumentNode } from '@tiptap/extension-document'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text as TextNode } from '@tiptap/extension-text'
import { Gapcursor, TrailingNode } from '@tiptap/extensions'
import type { ResolvedFeatures } from './registry'

/**
 * The always-on schema kernel. You can't have a document without a top node,
 * paragraphs and text, so these are never opt-in — features build on top.
 * TrailingNode keeps an empty paragraph after the last block (table, code,
 * conditional block…) so you can always click below it and keep typing —
 * except after a document footer, which is meant to stay last.
 * Gapcursor lets you place a caret in the gaps around isolating/atom blocks
 * (a conditional block, a table…) — e.g. to type *after* a nested conditional
 * but still inside its parent, which `isolating` otherwise traps you out of.
 */
export function kernelExtensions(): AnyExtension[] {
  return [
    DocumentNode,
    Paragraph,
    TextNode,
    Gapcursor,
    TrailingNode.configure({ notAfter: ['documentFooter'] }),
  ]
}

/**
 * One synthetic extension that installs every feature's extra keybinding,
 * routing each to its registered command. Keeps keymap ownership in our SDK.
 */
function registryKeymap(resolved: ResolvedFeatures): Extension {
  return Extension.create({
    name: 'registryKeymap',
    addKeyboardShortcuts() {
      const { editor } = this
      const shortcuts: Record<string, () => boolean> = {}
      for (const [key, commandId] of Object.entries(resolved.keymap)) {
        const command = resolved.commands[commandId]
        if (command) {
          shortcuts[key] = () => command(editor)
        }
      }
      return shortcuts
    },
  })
}

/** Kernel + feature extensions + the synthetic keymap extension. */
export function buildExtensions(resolved: ResolvedFeatures): AnyExtension[] {
  return [...kernelExtensions(), ...resolved.extensions, registryKeymap(resolved)]
}
