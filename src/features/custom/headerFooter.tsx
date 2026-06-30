import {
  defineFeature,
  mergeAttributes,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '../../editor'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

/** True when a top-level node of `name` exists. */
function docHasNode(doc: PMNode, name: string): boolean {
  let found = false
  doc.forEach((node) => {
    if (node.type.name === name) found = true
  })
  return found
}

/** Delete the (single) top-level node of `name`, if present. */
function removeRegion(editor: Editor, name: string): boolean {
  let range: { from: number; to: number } | null = null
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === name) range = { from: offset, to: offset + node.nodeSize }
  })
  if (!range) return false
  return editor.chain().focus().deleteRange(range).run()
}

/** Editable header/footer region: a faint label + a hover "Remover" + content. */
function HeaderFooterView({ node, deleteNode }: NodeViewProps) {
  const isHeader = node.type.name === 'documentHeader'
  return (
    <NodeViewWrapper className={`doc-region doc-region--${isHeader ? 'header' : 'footer'}`}>
      <div className="doc-region__bar" contentEditable={false}>
        <span className="doc-region__label">{isHeader ? 'Header' : 'Footer'}</span>
        <button
          type="button"
          className="doc-region__remove"
          aria-label={`Remove ${isHeader ? 'header' : 'footer'}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => deleteNode()}
        >
          Remove
        </button>
      </div>
      <NodeViewContent className="doc-region__content" />
    </NodeViewWrapper>
  )
}

/** Singleton block region serialized to a `data-*` div the backend reads. */
function regionNode(name: string, dataAttr: string, regionClass: string) {
  return Node.create({
    name,
    group: 'block',
    content: 'block+',
    defining: true,
    isolating: true,

    parseHTML() {
      return [{ tag: `div[${dataAttr}]` }]
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { [dataAttr]: '', class: regionClass }), 0]
    },

    addNodeView() {
      return ReactNodeViewRenderer(HeaderFooterView)
    },
  })
}

const DocumentHeader = regionNode('documentHeader', 'data-document-header', 'doc-region doc-region--header')
const DocumentFooter = regionNode('documentFooter', 'data-document-footer', 'doc-region doc-region--footer')

/**
 * "Team" feature: a page header and footer. Each is a singleton block at the
 * top/bottom of the document (so it can hold rich content — text, merge fields…
 * — and the backend repeats it per PDF page). The hover "add" affordance is
 * page chrome contributed via `pageRegions`; the editor only stores the nodes.
 */
export const HeaderFooterFeature = defineFeature({
  id: 'headerFooter',
  extensions: () => [DocumentHeader, DocumentFooter],
  commands: {
    'header.add': (editor) => {
      if (docHasNode(editor.state.doc, 'documentHeader')) return false
      return editor
        .chain()
        .insertContentAt(0, { type: 'documentHeader', content: [{ type: 'paragraph' }] })
        .focus('start')
        .run()
    },
    'footer.add': (editor) => {
      if (docHasNode(editor.state.doc, 'documentFooter')) return false
      return editor
        .chain()
        .insertContentAt(editor.state.doc.content.size, {
          type: 'documentFooter',
          content: [{ type: 'paragraph' }],
        })
        .focus('end')
        .run()
    },
    'header.remove': (editor) => removeRegion(editor, 'documentHeader'),
    'footer.remove': (editor) => removeRegion(editor, 'documentFooter'),
  },
  pageRegions: [
    {
      id: 'header',
      position: 'top',
      label: 'Add header',
      addCommandId: 'header.add',
      nodeName: 'documentHeader',
    },
    {
      id: 'footer',
      position: 'bottom',
      label: 'Add footer',
      addCommandId: 'footer.add',
      nodeName: 'documentFooter',
    },
  ],
})
