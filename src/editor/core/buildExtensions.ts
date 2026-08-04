import { Extension, resolveExtensions } from '@tiptap/core'
import type { AnyExtension } from '@tiptap/core'
import { Document as DocumentNode } from '@tiptap/extension-document'
import { HardBreak } from '@tiptap/extension-hard-break'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text as TextNode } from '@tiptap/extension-text'
import { UniqueID } from '@tiptap/extension-unique-id'
import { Dropcursor, Gapcursor } from '@tiptap/extensions'
import { BodyTrailingNode } from './bodyTrailingNode'
import { NODE_ID_ATTRIBUTE, carriesNodeId, generateNodeId } from './nodeIds'
import type { ResolvedFeatures } from './registry'

/**
 * The always-on schema kernel. You can't have a document without a top node,
 * paragraphs and text, so these are never opt-in — features build on top.
 * HardBreak is kernel for the same reason: Shift+Enter is basic typing, not a
 * feature (it ships its own Shift-Enter/Mod-Enter bindings and serializes as a
 * plain <br>, so the backend HTML contract is untouched).
 * BodyTrailingNode keeps an empty paragraph after the last BODY block (table,
 * code, conditional block…) so you can always click below it and keep typing —
 * kept just above a bottom-pinned page region (e.g. a document footer), which
 * is meant to stay last. Those region node names come from the enabled
 * features' `pageRegions` metadata, so the kernel never hardcodes a feature's
 * node name. (Stock TrailingNode only guards the document's last child, so a
 * footer would defeat it — hence the body-aware variant.)
 * Gapcursor lets you place a caret in the gaps around isolating/atom blocks
 * (a conditional block, a table…) — e.g. to type *after* a nested conditional
 * but still inside its parent, which `isolating` otherwise traps you out of.
 * Dropcursor draws the insertion indicator for ProseMirror's NATIVE drop
 * handling (dragged text, images, variable chips from the panel) — drops work
 * without it, but land "blind".
 */
function kernelExtensions(resolved: ResolvedFeatures): AnyExtension[] {
  const bottomRegions = resolved.pageRegions
    .filter((region) => region.position === 'bottom')
    .map((region) => region.nodeName)
  return [
    DocumentNode,
    Paragraph,
    TextNode,
    HardBreak,
    Gapcursor,
    Dropcursor,
    BodyTrailingNode.configure({ notAfter: bottomRegions }),
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

/**
 * Every node type the final schema will hold except `doc` and `text` — the
 * UniqueID scope. Derived from the actual extension list, with
 * `resolveExtensions` flattening `addExtensions()` first (TableKit hides
 * TableRow that way), so nodes from any feature — including kits authored by
 * consumer teams later — are covered without registration. (A later TipTap
 * 3.x ships `types: 'all'` with the same doc/text exclusions — on upgrade
 * this enumeration can collapse into it.)
 */
function nodeIdTypes(extensions: AnyExtension[]): string[] {
  const names = resolveExtensions(extensions)
    .filter((extension) => extension.type === 'node')
    .map((extension) => extension.name)
    .filter(carriesNodeId)
  return [...new Set(names)]
}

/** Kernel + feature extensions + the synthetic keymap extension + UniqueID,
 *  which stamps a `uid` on every content node. The entry points inject ids
 *  BEFORE content reaches the editor (see nodeIds.ts), so the extension never
 *  backfills the entry document — it covers everything born after entry:
 *  typing, splits, paste, and nodes other plugins append during a load
 *  transaction (BodyTrailingNode's trailing paragraph; see nodeIds.test.ts). */
export function buildExtensions(resolved: ResolvedFeatures): AnyExtension[] {
  // Everything that can contribute to the schema, in one list — the id scope
  // is computed from exactly this list, so the only extension outside it is
  // UniqueID itself, which contributes no nodes by construction.
  const schemaExtensions = [
    ...kernelExtensions(resolved),
    ...resolved.extensions,
    registryKeymap(resolved),
  ]
  return [
    ...schemaExtensions,
    UniqueID.configure({
      attributeName: NODE_ID_ATTRIBUTE,
      types: nodeIdTypes(schemaExtensions),
      generateID: generateNodeId,
    }),
  ]
}
