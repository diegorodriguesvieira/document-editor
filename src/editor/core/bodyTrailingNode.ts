import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface BodyTrailingNodeOptions {
  /**
   * Node names pinned to the BOTTOM of the document (e.g. a document footer).
   * The trailing paragraph is kept just ABOVE the first of these, never after
   * them — a bottom region must stay last.
   */
  notAfter: string[]
}

/**
 * Keeps an empty paragraph at the END OF THE BODY so you can always click below
 * the last block — a table, image, code block… — and keep typing.
 *
 * Stock `TrailingNode` only guards the document's very last child. With a
 * bottom-pinned region present (a document footer), that child is the footer,
 * so stock TrailingNode never fires and a table ending the body gets trapped
 * against the footer: there's no text position between them, so clicking below
 * the (possibly borderless, invisible) table lands a gap cursor that the
 * region guard bounces away. This variant inserts the trailing paragraph right
 * ABOVE the first bottom region instead — and falls back to the document end
 * when there is none, so it fully subsumes the stock behavior.
 */
export const BodyTrailingNode = Extension.create<BodyTrailingNodeOptions>({
  name: 'bodyTrailingNode',

  addOptions() {
    return { notAfter: [] }
  },

  addProseMirrorPlugins() {
    const bottomRegions = new Set(this.options.notAfter)
    // The document's top node dictates the trailing block type (paragraph
    // here) — the same node stock TrailingNode uses and skips over.
    const defaultType =
      this.editor.schema.topNodeType.contentMatch.defaultType ??
      this.editor.schema.nodes.paragraph

    return [
      new Plugin({
        key: new PluginKey('bodyTrailingNode'),
        appendTransaction: (transactions, _oldState, state) => {
          if (!defaultType) return null
          if (!transactions.some((tr) => tr.docChanged)) return null

          const { doc, tr } = state
          // End of the body = just before the first bottom-pinned region, or
          // the document end when there is none.
          let insertPos = doc.content.size
          let offset = 0
          for (let i = 0; i < doc.childCount; i += 1) {
            const child = doc.child(i)
            if (bottomRegions.has(child.type.name)) {
              insertPos = offset
              break
            }
            offset += child.nodeSize
          }

          // Already typeable (a trailing paragraph), or a body so empty the
          // region guard owns restoring it — leave it be. Otherwise append the
          // paragraph. The insert is idempotent: the next run sees a paragraph
          // there and stops, so this converges in one extra transaction.
          const before = doc.resolve(insertPos).nodeBefore
          if (!before || before.type === defaultType) return null
          return tr.insert(insertPos, defaultType.create())
        },
      }),
    ]
  },
})
