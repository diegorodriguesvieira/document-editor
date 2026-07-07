import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { DocumentEditor, type DocumentEditorRenderContext } from './DocumentEditor'
import { InsertToolbar } from './InsertToolbar'
import { useFeatureState } from '../hooks/useFeatureState'
import { createEmptyDocument } from '../core/document'
import type { EditorApi } from '../core/EditorApi'
import { BoldFeature, TableFeature } from '../../features'
import { docWith, jsonHasNode } from '../../test/editorHarness'

describe('<DocumentEditor /> empty state', () => {
  it('shows while the document is empty and disappears once there is content', async () => {
    let api: EditorApi | null = null
    render(
      <DocumentEditor
        features={[BoldFeature]}
        renderEmptyState={() => <div>Blank — start typing</div>}
        onReady={(ready) => {
          api = ready
        }}
      />,
    )

    expect(await screen.findByText('Blank — start typing')).toBeInTheDocument()

    act(() => {
      api!.setJSON(docWith('hello'))
    })
    await waitFor(() => {
      expect(screen.queryByText('Blank — start typing')).toBeNull()
    })
  })

  it('never shows when the editor starts with content', async () => {
    render(
      <DocumentEditor
        features={[BoldFeature]}
        content={docWith('already has text')}
        renderEmptyState={() => <div>Blank — start typing</div>}
      />,
    )

    await screen.findByText('already has text')
    expect(screen.queryByText('Blank — start typing')).toBeNull()
  })

  it('disappears for content WITHOUT text too — inserting a table dismisses it', async () => {
    let api: EditorApi | null = null
    render(
      <DocumentEditor
        features={[TableFeature]}
        renderEmptyState={() => <div>Blank — start typing</div>}
        onReady={(ready) => {
          api = ready
        }}
      />,
    )
    expect(await screen.findByText('Blank — start typing')).toBeInTheDocument()

    act(() => {
      api!.exec('table.insert') // 3×3 of EMPTY cells — not a single character
    })

    // The doc has no text at all, but it is no longer blank: overlay gone.
    // (TipTap's editor.isEmpty would still say true here — the regression this
    // test pins.)
    await waitFor(() => {
      expect(screen.queryByText('Blank — start typing')).toBeNull()
    })

    // And wiping back to the blank slate brings it back.
    act(() => {
      api!.setJSON(createEmptyDocument())
    })
    expect(await screen.findByText('Blank — start typing')).toBeInTheDocument()
  })

})

describe('<DocumentEditor /> chrome shells and layout', () => {
  it('ships header and footer by DEFAULT: an empty header bar + the insert actions in the footer', async () => {
    render(<DocumentEditor features={[TableFeature]} />)

    await screen.findByRole('toolbar', { name: 'Insert' })
    const header = document.querySelector('.document-editor__header')
    expect(header).not.toBeNull() // the bar exists even with no content yet
    const footer = document.querySelector('.document-editor__footer')
    expect(footer).not.toBeNull()
    expect(footer!.contains(screen.getByRole('toolbar', { name: 'Insert' }))).toBe(true)
  })

  it('renderHeader fills the fixed shell; returning null hides the bar (teams without a header)', async () => {
    const { rerender } = render(
      <DocumentEditor features={[BoldFeature]} renderHeader={() => <span>Meu título</span>} />,
    )
    const header = await waitFor(() => {
      const el = document.querySelector('.document-editor__header')
      expect(el).not.toBeNull()
      return el!
    })
    expect(within(header as HTMLElement).getByText('Meu título')).toBeInTheDocument()

    rerender(<DocumentEditor features={[BoldFeature]} renderHeader={() => null} />)
    expect(document.querySelector('.document-editor__header')).toBeNull()
  })

  it('renderFooter={() => null} removes the footer entirely (read-only mode) — clearance included', async () => {
    render(<DocumentEditor features={[TableFeature]} renderFooter={() => null} />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())

    expect(document.querySelector('.document-editor__footer')).toBeNull()
    expect(screen.queryByRole('toolbar', { name: 'Insert' })).toBeNull()
  })

  it('hides BOTH shells for any nothing-to-render return (undefined/booleans) — never an empty floating bar', async () => {
    // The `cond && <Bar/>` idiom returns false; undefined/true are equally
    // legal ReactNode "nothing" values. All must hide the shell like null —
    // an empty fixed pill + phantom clearance shipped as a real bug.
    for (const nothing of [null, undefined, false, true]) {
      const { unmount } = render(
        <DocumentEditor
          features={[TableFeature]}
          renderHeader={() => nothing}
          renderFooter={() => nothing}
        />,
      )
      await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
      expect(document.querySelector('.document-editor__header'), `header for ${String(nothing)}`).toBeNull()
      expect(document.querySelector('.document-editor__footer'), `footer for ${String(nothing)}`).toBeNull()
      unmount()
    }
  })

  it('a feature set with NO inserts gets no default footer (nothing to act on)', async () => {
    render(<DocumentEditor features={[BoldFeature]} />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    expect(document.querySelector('.document-editor__footer')).toBeNull()
  })

  it('LIVE header state: a useFeatureState read inside renderHeader tracks document edits', async () => {
    // The render prop runs on React renders, not on transactions — the
    // catalog's blessed recipe for live chrome is a small component reading
    // through useFeatureState. Pin that the recipe actually updates.
    function Status({ ctx }: { ctx: DocumentEditorRenderContext }) {
      const isEmpty = useFeatureState(ctx.editor, () => ctx.api.isEmpty())
      return <span>{isEmpty ? 'empty' : 'editing'}</span>
    }
    let api: EditorApi | null = null
    render(
      <DocumentEditor
        features={[BoldFeature]}
        renderHeader={(ctx) => <Status ctx={ctx} />}
        onReady={(ready) => {
          api = ready
        }}
      />,
    )
    expect(await screen.findByText('empty')).toBeInTheDocument()

    act(() => {
      api!.setJSON(docWith('now it has content'))
    })
    await waitFor(() => expect(screen.getByText('editing')).toBeInTheDocument())
  })

  it('renderFooter keeps the SDK shell and swaps the CONTENT (custom composition with ctx)', async () => {
    render(
      <DocumentEditor
        features={[TableFeature]}
        renderFooter={(ctx) => (
          <div className="minha-composicao">
            <InsertToolbar {...ctx} className="acoes" />
            <button type="button">Enviar</button>
          </div>
        )}
      />,
    )

    const footer = await waitFor(() => {
      const el = document.querySelector('.document-editor__footer')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(footer.querySelector('.minha-composicao')).not.toBeNull()
    expect(within(footer).getByRole('toolbar', { name: 'Insert' })).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: 'Enviar' })).toBeInTheDocument()
  })

  it('the zoom prop scales the page and gates the scroll-clip class at STRICTLY > 1', async () => {
    // The class goes on the OUTER __zoom scroller; the style on the INNER
    // __scale. At exactly 1 the clip must be off (it would slice the image
    // handles at the column edge).
    const { rerender } = render(<DocumentEditor features={[BoldFeature]} zoom={1.2} />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    const scale = () => document.querySelector('.document-editor__scale') as HTMLElement
    expect(scale().style.zoom).toBe('1.2')
    expect(document.querySelector('.document-editor__zoom--scrolls')).not.toBeNull()

    rerender(<DocumentEditor features={[BoldFeature]} zoom={1} />)
    expect(scale().style.zoom).toBe('1')
    expect(document.querySelector('.document-editor__zoom--scrolls')).toBeNull()

    rerender(<DocumentEditor features={[BoldFeature]} zoom={0.5} />)
    expect(scale().style.zoom).toBe('0.5')
    expect(document.querySelector('.document-editor__zoom--scrolls')).toBeNull()
  })

  it('mounts consumer panels in BOTH gutters, each with the render context', async () => {
    render(
      <DocumentEditor
        features={[BoldFeature]}
        renderLeftPanel={(ctx) => <nav>esquerda {String(Boolean(ctx.api))}</nav>}
        renderRightPanel={() => <nav>direita</nav>}
      />,
    )

    const left = (await screen.findByText('esquerda true')).closest('aside')
    expect(left?.className).toBe('document-editor__panel document-editor__panel--left')
    const right = screen.getByText('direita').closest('aside')
    expect(right?.className).toBe('document-editor__panel document-editor__panel--right')
  })

  it('the insert items can live in the LEFT panel instead of the dock (headless InsertToolbar)', async () => {
    const user = userEvent.setup()
    let api: EditorApi | null = null
    render(
      <DocumentEditor
        features={[TableFeature]}
        onReady={(ready) => {
          api = ready
        }}
        renderFooter={() => null} // no footer at all…
        renderLeftPanel={(ctx) => <InsertToolbar {...ctx} className="side-inserts" />}
      />,
    )

    // …so the ONLY insert surface is the consumer's panel.
    const items = await screen.findByRole('toolbar', { name: 'Insert' })
    expect(items.className).toBe('side-inserts')
    expect(items.closest('aside')?.className).toContain('document-editor__panel--left')
    expect(document.querySelector('.document-editor__footer')).toBeNull()

    // And it is the same LIVE surface — clicking really inserts.
    await user.click(within(items).getByRole('button', { name: 'Table' }))
    await waitFor(() => expect(jsonHasNode(api!.getJSON().doc, 'table')).toBe(true))
  })

})
