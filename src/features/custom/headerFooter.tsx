import { useRef, useState } from 'react'
import {
  defineFeature,
  mergeAttributes,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useDismissable,
  type NodeViewProps,
} from '../../editor'
import { Extension, type Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

/** The region (header/footer) a resolved position sits inside, if any. */
function regionNameAt($pos: ResolvedPos): string | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const name = $pos.node(depth).type.name
    if (name === 'documentHeader' || name === 'documentFooter') return name
  }
  return null
}

/** The guard's shared editing state (which region is open for editing). */
export function guardStorage(editor: Editor): { editing: string | null } {
  return (editor.storage as unknown as { headerFooterGuard: { editing: string | null } })
    .headerFooterGuard
}

/** True when a top-level node of `name` exists. */
function docHasNode(doc: PMNode, name: string): boolean {
  let found = false
  doc.forEach((node) => {
    if (node.type.name === name) found = true
  })
  return found
}

/**
 * Editable header/footer region with Google-Docs entry semantics: a single
 * click does NOT drop the caret in — DOUBLE-click activates editing (and
 * places the caret where you clicked); clicking outside (or Escape) leaves.
 */
function HeaderFooterView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const isHeader = node.type.name === 'documentHeader'
  // A freshly ADDED region mounts already open for editing (the add command
  // opens the gate so the user can type immediately) — sync from the storage.
  const [editing, setEditing] = useState(() => guardStorage(editor).editing === node.type.name)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const deactivate = () => {
    setEditing(false)
    const storage = guardStorage(editor)
    if (storage.editing === node.type.name) storage.editing = null
    // If the caret is still inside (Escape), push it out to the adjacent body
    // position — otherwise typing would keep editing a "closed" region.
    const { doc, selection } = editor.state
    if (regionNameAt(selection.$from) === node.type.name) {
      const headerSize = doc.firstChild?.type.name === 'documentHeader' ? doc.firstChild.nodeSize : 0
      const footerSize = doc.lastChild?.type.name === 'documentFooter' ? doc.lastChild.nodeSize : 0
      editor.commands.setTextSelection(isHeader ? headerSize + 1 : doc.content.size - footerSize - 1)
    }
  }
  useDismissable(wrapperRef, deactivate, { enabled: editing })

  const activate = (event: React.MouseEvent) => {
    // Open the gate BEFORE placing the caret, or the selection gate bounces it.
    guardStorage(editor).editing = node.type.name
    setEditing(true)
    // The single-click caret was suppressed — place it at the click point now
    // (fallback: the region's first text position, e.g. when the double-click
    // landed on the label bar).
    const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
    const fallback = typeof getPos === 'function' ? (getPos() ?? 0) + 2 : null
    const pos = coords?.pos ?? fallback
    if (pos != null) editor.chain().focus().setTextSelection(pos).run()
  }

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className={`doc-region doc-region--${isHeader ? 'header' : 'footer'}${
        editing ? ' doc-region--editing' : ''
      }`}
      onMouseDown={(event: React.MouseEvent) => {
        if (!editing) event.preventDefault() // no caret on single click
      }}
      onDoubleClick={editing ? undefined : activate}
    >
      <div
        className="doc-region__bar"
        contentEditable={false}
        // The bar is chrome: swallow mousedown so a click here (e.g. the 2nd
        // click of a double-click on the "Add header +" affordance, which
        // lands on the freshly-mounted bar) can't blur the caret.
        onMouseDown={(event) => event.preventDefault()}
      >
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

  addStorage() {
    // Which region is currently open for editing (set by double-click in the
    // node view, cleared on click-outside/Escape). The selection gate below
    // only lets the caret live inside THIS region.
    return { editing: null as string | null }
  },

  addKeyboardShortcuts() {
    return {
      // Google-Docs select-all: in the BODY, header/footer stay out of the
      // selection; INSIDE a region, only that region's content is selected.
      'Mod-a': ({ editor }) => {
        const { doc, selection } = editor.state
        const first = doc.firstChild
        const last = doc.lastChild
        const headerSize = first?.type.name === 'documentHeader' ? first.nodeSize : 0
        const footerSize = last?.type.name === 'documentFooter' ? last.nodeSize : 0
        if (!headerSize && !footerSize) return false // no regions → default Cmd+A

        // Caret inside a region → select that region's content only.
        for (let depth = selection.$from.depth; depth > 0; depth--) {
          const name = selection.$from.node(depth).type.name
          if (name === 'documentHeader' || name === 'documentFooter') {
            return editor.commands.setTextSelection({
              from: selection.$from.start(depth),
              to: selection.$from.end(depth),
            })
          }
        }
        // Caret in the body → select the body only.
        return editor.commands.setTextSelection({
          from: headerSize + 1,
          to: doc.content.size - footerSize - 1,
        })
      },
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage as { editing: string | null }
    return [
      new Plugin({
        key: new PluginKey('headerFooterGuard'),
        // No gap cursor ABOVE the header / BELOW the footer: typing there would
        // put content the normalizer immediately reorders (a cursor that lies).
        // Google-Docs behavior: clicking/arrowing into those gaps does nothing.
        filterTransaction: (tr) => {
          if (tr.docChanged || !tr.selectionSet) return true
          const selection = tr.selection
          if (!(selection instanceof GapCursor)) return true
          const { doc } = tr
          if (selection.head === 0 && doc.firstChild?.type.name === 'documentHeader') return false
          if (
            selection.head === doc.content.size &&
            doc.lastChild?.type.name === 'documentFooter'
          ) {
            return false
          }
          return true
        },
        appendTransaction: (transactions, _oldState, newState) => {
          if (transactions.some((tr) => tr.docChanged)) {
            const desired = normalizedRegions(newState.doc)
            if (desired) {
              const tr = newState.tr
              tr.replaceWith(0, newState.doc.content.size, Fragment.fromArray(desired))
              tr.setMeta('addToHistory', false)
              return tr
            }
          }

          // SELECTION GATE — regions are entered by DOUBLE-CLICK only. Any
          // selection landing inside a region that is not open for editing
          // (arrow keys, shift-selection, a load's initial selection…) is
          // clamped back to the body. Runs after every transaction, so there
          // is no path around it.
          const { doc, selection } = newState
          const first = doc.firstChild
          const last = doc.lastChild
          const headerSize = first?.type.name === 'documentHeader' ? first.nodeSize : 0
          const footerSize = last?.type.name === 'documentFooter' ? last.nodeSize : 0
          if (!headerSize && !footerSize) return null

          const touched = regionNameAt(selection.$from) ?? regionNameAt(selection.$to)
          if (!touched || touched === storage.editing) return null

          const bodyFrom = headerSize + 1
          const bodyTo = doc.content.size - footerSize - 1
          const clamp = (pos: number) => Math.min(Math.max(pos, bodyFrom), bodyTo)
          const next = TextSelection.between(
            doc.resolve(clamp(selection.from)),
            doc.resolve(clamp(selection.to)),
          )
          if (next.eq(selection)) return null
          return newState.tr.setSelection(next)
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
      // Open the gate BEFORE focusing, so the caret is allowed in and the
      // user can type the header right away (the view mounts in editing mode).
      guardStorage(editor).editing = 'documentHeader'
      const applied = editor
        .chain()
        .insertContentAt(0, { type: 'documentHeader', content: [{ type: 'paragraph' }] })
        .focus('start')
        .run()
      if (!applied) guardStorage(editor).editing = null
      return applied
    },
    'footer.add': (editor) => {
      if (docHasNode(editor.state.doc, 'documentFooter')) return false
      guardStorage(editor).editing = 'documentFooter'
      const applied = editor
        .chain()
        .insertContentAt(editor.state.doc.content.size, {
          type: 'documentFooter',
          content: [{ type: 'paragraph' }],
        })
        .focus('end')
        .run()
      if (!applied) guardStorage(editor).editing = null
      return applied
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
