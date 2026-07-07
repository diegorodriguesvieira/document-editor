import { useEffect, useRef } from 'react'
import Button from '@mui/material/Button'
import { POPUP_CLASS } from '../../editor'
import {
  defineFeature,
  hasTopLevelNode,
  mergeAttributes,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useDismissable,
  useFeatureState,
  type NodeViewProps,
} from '../../editor'
import { Extension, type Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import type { Mappable } from '@tiptap/pm/transform'

/** The two region node names — single source for every rule in this file. */
const REGION_TOP = 'documentHeader'
const REGION_BOTTOM = 'documentFooter'

/** Depth of the region (header/footer) ancestor at `$pos`, or null. */
function regionDepthAt($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const name = $pos.node(depth).type.name
    if (name === REGION_TOP || name === REGION_BOTTOM) return depth
  }
  return null
}

/** The region a resolved position sits inside, if any. */
function regionNameAt($pos: ResolvedPos): string | null {
  const depth = regionDepthAt($pos)
  return depth === null ? null : $pos.node(depth).type.name
}

/** Region sizes + the body's text range — THE definition of "the body". */
function regionBounds(doc: PMNode) {
  const headerSize = doc.firstChild?.type.name === REGION_TOP ? doc.firstChild.nodeSize : 0
  const footerSize = doc.lastChild?.type.name === REGION_BOTTOM ? doc.lastChild.nodeSize : 0
  return {
    headerSize,
    footerSize,
    bodyFrom: headerSize + 1,
    bodyTo: doc.content.size - footerSize - 1,
  }
}

/**
 * A selection spanning [from, to] whose endpoints may sit on NODE boundaries
 * (image, table…) — `TextSelection` can't (its endpoints must be inline), so a
 * body/region select-all built on it would skip a leading image and Delete
 * would leave the image behind. Modeled on ProseMirror's own `AllSelection`;
 * degrades to a plain TextSelection after any document change.
 */
class RangeSelection extends Selection {
  static create(doc: PMNode, from: number, to: number): RangeSelection {
    return new RangeSelection(doc.resolve(from), doc.resolve(to))
  }

  map(doc: PMNode, mapping: Mappable): Selection {
    return TextSelection.between(
      doc.resolve(mapping.map(this.from)),
      doc.resolve(mapping.map(this.to)),
    )
  }

  eq(other: Selection): boolean {
    return other instanceof RangeSelection && other.from === this.from && other.to === this.to
  }

  toJSON(): { type: string; from: number; to: number } {
    return { type: 'regionRangeSelectAll', from: this.from, to: this.to }
  }

  static fromJSON(doc: PMNode, json: { from: number; to: number }): RangeSelection {
    return RangeSelection.create(doc, json.from, json.to)
  }
}
try {
  Selection.jsonID('regionRangeSelectAll', RangeSelection)
} catch {
  // Already registered (dev HMR re-evaluates the module) — safe to ignore.
}

/** The guard's shared editing state (which region is open for editing). */
function guardStorage(editor: Editor): { editing: string | null } {
  return (editor.storage as unknown as { headerFooterGuard: { editing: string | null } })
    .headerFooterGuard
}

/**
 * Closes the editing gate for `name`. The empty dispatch lets the selection
 * gate expel a caret still inside the region (one mechanism owns the clamp)
 * and re-renders the node view (its `editing` state derives from the storage).
 * Exported for tests — the exit path is part of the behavior contract.
 */
export function closeRegion(editor: Editor, name: string): void {
  const storage = guardStorage(editor)
  if (storage.editing !== name) return
  storage.editing = null
  editor.view.dispatch(editor.state.tr)
}

/**
 * Editable header/footer region with Google-Docs entry semantics: a single
 * click does NOT drop the caret in — DOUBLE-click activates editing (and
 * places the caret where you clicked); clicking elsewhere in the DOCUMENT
 * (or Escape) leaves. Toolbar/bubble/popover clicks keep the region open.
 */
function HeaderFooterView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const isHeader = node.type.name === REGION_TOP
  // Derived from the guard's storage (single source of truth): the add
  // commands and double-click both open the gate, and every open/close is
  // followed by a dispatch, so this stays fresh.
  const editing =
    useFeatureState(editor, () => guardStorage(editor).editing === node.type.name) ?? false
  const wrapperRef = useRef<HTMLDivElement>(null)

  // If this region unmounts while open (Remove, undo, setJSON swap), don't
  // leave the gate ajar for a future region of the same name.
  useEffect(() => {
    return () => {
      const storage = guardStorage(editor)
      if (storage.editing === node.type.name) storage.editing = null
    }
  }, [editor, node.type.name])

  useDismissable(wrapperRef, () => closeRegion(editor, node.type.name), {
    enabled: editing,
    // Google-Docs exit rule: the ONLY clicks that keep the region open are on
    // editor CONTROLS — toolbar/bubble buttons (so formatting applies inside
    // the region, not to an expelled caret) and portaled popovers. Anything
    // else — the document body, the white canvas, app chrome — closes it.
    isOutsideClick: (target) => {
      if (wrapperRef.current?.contains(target)) return false // the region itself
      const el = target instanceof Element ? target : target.parentElement
      if (!el) return true
      if (el.closest(`.${POPUP_CLASS}`)) return false // portaled popovers
      if (editor.view.dom.contains(el)) return true // elsewhere in the document
      const shell = editor.view.dom.closest('.document-editor')
      const isControl = Boolean(
        shell?.contains(el) && el.closest('button, select, input, textarea, label'),
      )
      return !isControl
    },
  })

  const activate = (event: React.MouseEvent) => {
    // Open the gate BEFORE placing the caret, or the selection gate bounces it.
    guardStorage(editor).editing = node.type.name
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
        <Button
          className="doc-region__remove"
          size="small"
          aria-label={`Remove ${isHeader ? 'header' : 'footer'}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => deleteNode()}
        >
          Remove
        </Button>
      </div>
      <NodeViewContent className="doc-region__content" />
    </NodeViewWrapper>
  )
}

/**
 * The selection gate's clamp, shared by the after-every-transaction gate and
 * the normalizer (whose own appended transaction ProseMirror never re-gates).
 * Returns the corrected selection for one touching a CLOSED region, or null
 * when the selection is allowed as-is.
 */
function clampSelectionToBody(
  doc: PMNode,
  selection: Selection,
  editing: string | null,
): Selection | null {
  const { headerSize, footerSize, bodyFrom, bodyTo } = regionBounds(doc)
  if (!headerSize && !footerSize) return null

  // An endpoint offends when it sits in a region that is not the open one —
  // check BOTH endpoints: short-circuiting on the first (`??`) would let a
  // selection anchored in the OPEN header reach into (and delete) the closed
  // footer. A NodeSelection OF a region has endpoints at depth 0 (regionNameAt
  // sees null) — the wrapped node itself offends.
  const offends = (region: string | null) => region !== null && region !== editing
  const nodeOffends =
    selection instanceof NodeSelection &&
    (selection.node.type.name === REGION_TOP || selection.node.type.name === REGION_BOTTOM) &&
    selection.node.type.name !== editing
  if (
    !nodeOffends &&
    !offends(regionNameAt(selection.$from)) &&
    !offends(regionNameAt(selection.$to))
  ) {
    return null
  }

  const clamp = (pos: number) => Math.min(Math.max(pos, bodyFrom), bodyTo)
  const next = TextSelection.between(
    doc.resolve(clamp(selection.from)),
    doc.resolve(clamp(selection.to)),
  )
  // The clamp can still land in a region: at a block boundary
  // TextSelection.between may walk BACKWARD into the header (e.g. a template
  // load whose mapped selection offends), and a body with no text position at
  // all (only leaf blocks — a divider) INVERTS the clamp. Verify the result;
  // prefer the body's first TEXT position (a template load must read like
  // "caret at the top", not like a node-selected leading image), and only a
  // truly text-less body falls back to selecting its first node / a gap
  // cursor (valid there — the GapCursor filter only bans the doc's outer
  // edges).
  if (regionNameAt(next.$from) ?? regionNameAt(next.$to)) {
    let fallback = Selection.findFrom(doc.resolve(headerSize), 1, true)
    if (!fallback || regionNameAt(fallback.$from)) {
      const child = doc.nodeAt(headerSize)
      fallback =
        child && NodeSelection.isSelectable(child)
          ? NodeSelection.create(doc, headerSize)
          : new GapCursor(doc.resolve(headerSize))
    }
    return fallback.eq(selection) ? null : fallback
  }
  return next.eq(selection) ? null : next
}

/** Singleton block region serialized to a `data-*` div the backend reads. */
function regionNode(name: string, dataAttr: string, regionClass: string) {
  return Node.create({
    name,
    group: 'block',
    content: 'block+',
    defining: true,
    isolating: true,
    // Backspace at the body's start (Delete at its end) node-selects the
    // previous/next block when it is selectable — a second press would then
    // DELETE the closed region wholesale. Non-selectable kills that path at
    // the source (the keymap becomes a no-op, Docs-style); the selection gate
    // still seals programmatic NodeSelection.create.
    selectable: false,

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

const DocumentHeader = regionNode(REGION_TOP, 'data-document-header', 'doc-region doc-region--header')
const DocumentFooter = regionNode(REGION_BOTTOM, 'data-document-footer', 'doc-region doc-region--footer')

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
    if (name === REGION_TOP) headers.push(node)
    else if (name === REGION_BOTTOM) footers.push(node)
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
  // Plugin precedence follows extension priority, not consumer feature order —
  // the guard's handleDrop must run BEFORE any feature's own drop handler
  // (e.g. the merge-field chip drop), or content lands in closed regions.
  priority: 1000,

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
        const { headerSize, footerSize } = regionBounds(doc)
        if (!headerSize && !footerSize) return false // no regions → default Cmd+A

        // RangeSelection (AllSelection-style) so leading/trailing NODES
        // (image, table) are part of the selection too — TextSelection would
        // skip them and Delete would leave them behind.
        const select = (from: number, to: number) => {
          editor.view.dispatch(
            editor.state.tr.setSelection(
              from < to
                ? RangeSelection.create(doc, from, to)
                : TextSelection.between(doc.resolve(from), doc.resolve(to)),
            ),
          )
          return true
        }

        const depth = regionDepthAt(selection.$from)
        if (depth !== null) {
          return select(selection.$from.start(depth), selection.$from.end(depth))
        }
        // NODE boundaries (not the first/last text position): the body starts
        // right after the header node — a leading image lives at
        // [headerSize, headerSize + 1] and `+ 1` would skip it.
        return select(headerSize, doc.content.size - footerSize)
      },
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage as { editing: string | null }
    return [
      new Plugin({
        key: new PluginKey('headerFooterGuard'),
        props: {
          // Drops write CONTENT, and the selection gate below only clamps the
          // caret afterwards — the payload would stay inside a closed region.
          // Regions are entered by double-click; an OPEN region accepts drops.
          handleDrop: (view, event) => {
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (!coords) return false
            const region = regionNameAt(view.state.doc.resolve(coords.pos))
            return region !== null && region !== storage.editing
          },
        },
        // No gap cursor ABOVE the header / BELOW the footer: typing there would
        // put content the normalizer immediately reorders (a cursor that lies).
        // Google-Docs behavior: clicking/arrowing into those gaps does nothing.
        filterTransaction: (tr) => {
          if (tr.docChanged || !tr.selectionSet) return true
          const selection = tr.selection
          if (!(selection instanceof GapCursor)) return true
          const { doc } = tr
          if (selection.head === 0 && doc.firstChild?.type.name === REGION_TOP) return false
          if (selection.head === doc.content.size && doc.lastChild?.type.name === REGION_BOTTOM) {
            return false
          }
          return true
        },
        appendTransaction: (transactions, oldState, newState) => {
          const docChanged = transactions.some((tr) => tr.docChanged)
          if (docChanged) {
            // The open region may have vanished (Remove, undo of add, setJSON
            // swap) — don't leave the gate ajar for a future region.
            if (storage.editing && !hasTopLevelNode(newState.doc, storage.editing)) {
              storage.editing = null
            }
            const desired = normalizedRegions(newState.doc)
            if (desired) {
              const tr = newState.tr
              tr.replaceWith(0, newState.doc.content.size, Fragment.fromArray(desired))
              tr.setMeta('addToHistory', false)
              // PM never re-runs appendTransaction on a plugin's OWN appended
              // transaction — the gate below cannot catch the selection this
              // rewrite produces (a paste's mapped selection can land inside
              // a closed region and the next keystroke would write there).
              // Clamp on this tr, against ITS doc.
              const clamped = clampSelectionToBody(tr.doc, tr.selection, storage.editing)
              if (clamped) tr.setSelection(clamped)
              return tr
            }

            // The BODY must keep at least one block: deleting a select-all
            // that includes edge nodes can leave just [header, footer] — an
            // uneditable document. Restore an empty paragraph (with the caret
            // in it) between the regions.
            const bounds = regionBounds(newState.doc)
            const regionCount = (bounds.headerSize ? 1 : 0) + (bounds.footerSize ? 1 : 0)
            if (regionCount > 0 && newState.doc.childCount === regionCount) {
              const tr = newState.tr.insert(
                bounds.headerSize,
                newState.schema.nodes.paragraph.create(),
              )
              tr.setSelection(TextSelection.create(tr.doc, bounds.headerSize + 1))
              return tr
            }
          }

          // Deleting ALL of an open region's content strands the caret outside
          // it: ProseMirror refills the schema hole (`block+`) and
          // Selection.near crosses the isolating boundary. If an edit moved
          // the caret out of the OPEN region while the region survived, pull
          // it back to the region's first text position.
          if (docChanged && storage.editing) {
            const wasInside = regionNameAt(oldState.selection.$from) === storage.editing
            const isInside = regionNameAt(newState.selection.$from) === storage.editing
            if (wasInside && !isInside) {
              const { footerSize } = regionBounds(newState.doc)
              const contentStart =
                storage.editing === REGION_TOP ? 1 : newState.doc.content.size - footerSize + 1
              return newState.tr.setSelection(
                TextSelection.near(newState.doc.resolve(contentStart), 1),
              )
            }
          }

          // SELECTION GATE — regions are entered by DOUBLE-CLICK only. Any
          // selection landing inside a region that is not open for editing
          // (arrow keys, shift-selection, a load's initial selection…) is
          // clamped back to the body. Runs after every transaction — the one
          // path PM never re-gates (a plugin's OWN appended transaction) is
          // the normalizer above, which clamps on its tr itself.
          const clamped = clampSelectionToBody(newState.doc, newState.selection, storage.editing)
          return clamped ? newState.tr.setSelection(clamped) : null
        },
      }),
    ]
  },
})

/**
 * Inserts the singleton region and opens its editing gate BEFORE focusing, so
 * the caret is allowed in and the user can type right away (the node view
 * mounts already in editing mode).
 */
function addRegion(editor: Editor, name: string, position: number, focusAt: 'start' | 'end'): boolean {
  if (hasTopLevelNode(editor.state.doc, name)) return false
  guardStorage(editor).editing = name
  const applied = editor
    .chain()
    .insertContentAt(position, { type: name, content: [{ type: 'paragraph' }] })
    .focus(focusAt)
    .run()
  if (!applied) guardStorage(editor).editing = null
  return applied
}

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
    'header.add': (editor) => addRegion(editor, REGION_TOP, 0, 'start'),
    'footer.add': (editor) =>
      addRegion(editor, REGION_BOTTOM, editor.state.doc.content.size, 'end'),
  },
  pageRegions: [
    {
      id: 'header',
      position: 'top',
      label: 'Add header',
      addCommandId: 'header.add',
      nodeName: REGION_TOP,
    },
    {
      id: 'footer',
      position: 'bottom',
      label: 'Add footer',
      addCommandId: 'footer.add',
      nodeName: REGION_BOTTOM,
    },
  ],
})
