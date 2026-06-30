import { useState } from 'react'
import { createPortal } from 'react-dom'
import { defineFeature, mergeAttributes, Node, type EditorApi } from '../../editor'
import { useDocumentVariables, type DocumentVariable } from './documentVariables'

/**
 * Inline atomic node — the "chip". Pure-DOM node view (lighter than React for
 * many chips). Doesn't depend on the variable list — only the modal does.
 */
const MergeField = Node.create({
  name: 'mergeField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-merge-field'),
        renderHTML: (attributes) =>
          attributes.id ? { 'data-merge-field': attributes.id as string } : {},
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-label'),
        renderHTML: (attributes) =>
          attributes.label ? { 'data-label': attributes.label as string } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-merge-field]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = (node.attrs.label ?? node.attrs.id ?? '') as string
    return ['span', mergeAttributes(HTMLAttributes, { class: 'merge-field' }), `{{${label}}}`]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.className = 'merge-field'
      dom.contentEditable = 'false'
      const id = (node.attrs.id ?? '') as string
      const label = (node.attrs.label ?? node.attrs.id ?? '') as string
      if (id) dom.setAttribute('data-merge-field', id)
      dom.textContent = `{{${label}}}`
      return { dom }
    }
  },
})

function MergeFieldModal({
  variables,
  onPick,
  onClose,
}: {
  variables: DocumentVariable[]
  onPick: (variable: DocumentVariable) => void
  onClose: () => void
}) {
  return (
    <div className="mf-modal__backdrop" onMouseDown={onClose}>
      <div
        className="mf-modal"
        role="dialog"
        aria-label="Variáveis"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mf-modal__header">
          <strong>Variáveis</strong>
          <button type="button" className="mf-modal__close" aria-label="Fechar" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="mf-modal__chips">
          {variables.length === 0 ? (
            <span className="mf-modal__empty">Carregando variáveis…</span>
          ) : (
            variables.map((variable) => (
              <button
                key={variable.id}
                type="button"
                className="mf-chip"
                onClick={() => onPick(variable)}
              >
                {variable.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function MergeFieldInsert({ api }: { api: EditorApi }) {
  const [open, setOpen] = useState(false)
  const variables = useDocumentVariables()
  return (
    <>
      <button
        type="button"
        className="insert-rail__btn"
        title="Inserir variável"
        aria-label="Inserir variável"
        aria-haspopup="dialog"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(true)}
      >
        @
      </button>
      {open
        ? // Portal to <body> so the fixed overlay escapes the sticky insert-rail's
          // stacking context (otherwise it paints behind the page).
          createPortal(
            <MergeFieldModal
              variables={variables}
              onClose={() => {
                setOpen(false)
                api.focus() // keep the editor focused after the modal closes
              }}
              // Keep the modal open so several variables can be added in a row.
              onPick={(variable) => api.exec('mergeField.insert', variable)}
            />,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * Static "team" feature: @-menu that inserts inline merge-field chips. The
 * variable list comes from {@link DocumentVariablesProvider} (consumer-owned),
 * so it can load async without touching the editor.
 */
export const MergeFieldFeature = defineFeature({
  id: 'mergeField',
  extensions: () => [MergeField],
  commands: {
    'mergeField.insert': (editor, payload) => {
      const field = (payload ?? {}) as { id?: string; label?: string }
      if (!field.id) return false
      return editor
        .chain()
        .focus()
        .insertContent([
          { type: 'mergeField', attrs: { id: field.id, label: field.label ?? field.id } },
          // Always a trailing space so the cursor isn't glued to the chip.
          { type: 'text', text: ' ' },
        ])
        .run()
    },
  },
  insert: [
    {
      id: 'mergeField',
      label: 'Variável',
      icon: '@',
      render: ({ api }) => <MergeFieldInsert api={api} />,
    },
  ],
})
