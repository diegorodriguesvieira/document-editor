import {
  defineFeature,
  mergeAttributes,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '../../editor'
import { Extension } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/** True when a top-level node of `name` exists. */
function docHasNode(doc: PMNode, name: string): boolean {
  let found = false
  doc.forEach((node) => {
    if (node.type.name === name) found = true
  })
  return found
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
 * The normalized top-level sequence: at most one header (first), at most one
 * footer (last), any extras dropped. Returns null when the doc is already valid.
 */
function normalizedRegions(doc: PMNode): PMNode[] | null {
  const headers: PMNode[] = []
  const footers: PMNode[] = []
  const body: PMNode[] = []
  doc.forEach((node) => {
    const name = node.type.name
    if (name === 'documentHeader') headers.push(node)
    else if (name === 'documentFooter') footers.push(node)
    else body.push(node)
  })
  if (headers.length === 0 && footers.length === 0) return null

  const desired: PMNode[] = []
  if (headers.length > 0) desired.push(headers[0])
  desired.push(...body)
  if (footers.length > 0) desired.push(footers[footers.length - 1])

  if (desired.length === doc.childCount) {
    let same = true
    for (let i = 0; i < desired.length; i++) {
      if (doc.child(i) !== desired[i]) {
        same = false
        break
      }
    }
    if (same) return null
  }
  return desired
}

/**
 * Enforces the header/footer invariant the `add` commands can't mediate — paste,
 * `setJSON`, drag can otherwise leave two headers or a footer mid-document and
 * break the PDF contract (one header at the top, repeated per page). Owned by the
 * feature (composes with the registry, zero consumer wiring); the schema can't
 * express it without a custom top node that breaks when the feature is off.
 */
const HeaderFooterGuard = Extension.create({
  name: 'headerFooterGuard',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headerFooterGuard'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const desired = normalizedRegions(newState.doc)
          if (!desired) return null
          const tr = newState.tr
          tr.replaceWith(0, newState.doc.content.size, Fragment.fromArray(desired))
          tr.setMeta('addToHistory', false)
          return tr
        },
      }),
    ]
  },
})

/**
 * "Team" feature: a page header and footer. Each is a singleton block at the
 * top/bottom of the document (so it can hold rich content — text, merge fields…
 * — and the backend repeats it per PDF page). The hover "add" affordance is
 * page chrome contributed via `pageRegions`; the editor only stores the nodes.
 */
export const HeaderFooterFeature = defineFeature({
  id: 'headerFooter',
  extensions: () => [DocumentHeader, DocumentFooter, HeaderFooterGuard],
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
